#!/usr/bin/env python3
"""Aiscoo 命名入口；复用历史启动器及其文件身份。"""
from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).resolve().parents[1] / "xcode" / "start-local.py"), run_name="__main__")
