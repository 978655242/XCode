"""Validate saved DOCX comments/settings with an external, read-only Office validator."""

import argparse
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile
from xml.etree import ElementTree as ET

# Allow direct execution without changing the production scripts' package imports.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills/docx"))
from scripts.add_toc_placeholders import _fix_update_fields
from scripts.document import Document, _pack_document
from scripts.utilities import XMLEditor

WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": WORD_NS}
# XCODE: CLI 也有 pnpm-workspace.yaml；桌面夹具位于外层产品仓库，不能选中内层 workspace。
REPO = next(parent for parent in Path(__file__).resolve().parents if (parent / "packages/desktop/package.json").is_file())
FIXTURE = REPO / "packages/desktop/test/e2e/fixtures/fs/conversation-session/conversation-session-assistant-preview-cards/sample.docx"


def settings(children):
    return (
        f'<w:settings xmlns:w="{WORD_NS}" '
        'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">'
        f'{children}</w:settings>'
    )


class SettingsRegression(unittest.TestCase):
    def validate_docx(self, output, valid=True):
        result = subprocess.run(
            [sys.executable, str(VALIDATOR), str(output), "--original", str(FIXTURE)],
            capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 0 if valid else 1, result.stdout + result.stderr)
        if not valid:
            self.assertIn("defaultTabStop", result.stdout + result.stderr)

    def test_comments_survive_schema_valid_save(self):
        variants = {
            "shipped": None,
            "early_only": settings('<w:zoom w:percent="100"/>'),
            "intervening": settings(
                '<w:revisionView/><w:doNotTrackMoves/><w:styleLockTheme/>'
                '<w:defaultTabStop w:val="720"/><w:alwaysMergeEmptyNamespace/>'
                '<w:footnotePr/><w:compat/><w:docVars><w:docVar w:name="keep" w:val="yes"/></w:docVars>'
                '<m:mathPr/><w:themeFontLang w:val="en-US"/><w:decimalSymbol w:val="."/>'
            ),
            "late_only": settings('<m:mathPr/><w:themeFontLang w:val="en-US"/><w:listSeparator w:val=","/>'),
            "existing": settings(
                '<w:zoom w:percent="90"/><w:trackRevisions w:val="false"/>'
                '<w:defaultTabStop w:val="720"/><w:updateFields w:val="false"/>'
                '<w:compat/><w:rsids><w:rsidRoot w:val="12345678"/></w:rsids>'
            ),
        }
        for name, xml in variants.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                source = root / "source"
                with zipfile.ZipFile(FIXTURE) as archive:
                    archive.extractall(source)
                if xml is not None:
                    (source / "word/settings.xml").write_text(xml, encoding="utf-8")
                baseline = root / "baseline.docx"
                _pack_document(source, baseline)
                self.validate_docx(baseline)
                original_text = self.document_text(source)
                original_settings = ET.parse(source / "word/settings.xml").getroot()
                doc = Document(source, rsid="76543210", track_revisions=True, author="Settings regression")
                self.addCleanup(doc.__del__)
                paragraph = doc["word/document.xml"].dom.getElementsByTagName("w:p")[0]
                comment_id = doc.add_comment(paragraph, paragraph, "Schema-valid comment")
                saved = root / "saved"
                doc.save(saved)
                output = root / "commented.docx"
                _pack_document(saved, output)
                self.validate_docx(output)
                self.assertEqual(self.document_text(saved), original_text)
                comments = ET.parse(saved / "word/comments.xml").getroot()
                comment = comments.find(f'w:comment[@w:id="{comment_id}"]', NS)
                self.assertIsNotNone(comment)
                self.assertIn("Schema-valid comment", "".join(comment.itertext()))
                document = ET.parse(saved / "word/document.xml").getroot()
                for marker in ("commentRangeStart", "commentRangeEnd", "commentReference"):
                    self.assertIsNotNone(document.find(f'.//w:{marker}[@w:id="{comment_id}"]', NS))
                after = ET.parse(saved / "word/settings.xml").getroot()
                for child in original_settings:
                    self.assertIsNotNone(after.find(child.tag))
                    self.assertEqual(after.find(child.tag).attrib, child.attrib)
                reopened = Document(saved, rsid="76543210", track_revisions=True)
                self.addCleanup(reopened.__del__)
                reopened.save()
                _pack_document(saved, output)
                self.validate_docx(output)
                after = ET.parse(saved / "word/settings.xml").getroot()
                for element in ("trackRevisions", "updateFields", "rsids"):
                    self.assertEqual(len(after.findall(f"w:{element}", NS)), 1)
                self.assertIn("Schema-valid comment", (saved / "word/comments.xml").read_text())
                # The TOC updater must also insert a missing updateFields before late settings.
                settings_editor = XMLEditor(saved / "word/settings.xml")
                for child in list(settings_editor.dom.getElementsByTagName("w:updateFields")):
                    child.parentNode.removeChild(child)
                settings_editor.save()
                _fix_update_fields(saved / "word/settings.xml")
                _pack_document(saved, output)
                self.validate_docx(output)

    def document_text(self, directory):
        return [node.text for node in ET.parse(directory / "word/document.xml").iter(f"{{{WORD_NS}}}t")]

    def test_validator_rejects_misplaced_update_fields(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source"
            with zipfile.ZipFile(FIXTURE) as archive:
                archive.extractall(source)
            (source / "word/settings.xml").write_text(
                settings('<w:updateFields w:val="true"/><w:defaultTabStop w:val="720"/>'),
                encoding="utf-8",
            )
            output = Path(temp) / "invalid.docx"
            _pack_document(source, output)
            self.validate_docx(output, valid=False)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--office-validator", required=True, type=Path)
    args, remaining = parser.parse_known_args()
    VALIDATOR = args.office_validator.resolve(strict=True)
    unittest.main(argv=[sys.argv[0], *remaining])
