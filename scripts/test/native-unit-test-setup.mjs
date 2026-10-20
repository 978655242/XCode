import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";

// XCODE: 每个 Node 测试进程独占 HOME；目录由外层 runner 在所有子进程退出后清理。
const home = await mkdtemp(join(process.env.ZCODE_DATA_BASE_DIR, "native-home-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.ZCODE_DATA_BASE_DIR = home;
