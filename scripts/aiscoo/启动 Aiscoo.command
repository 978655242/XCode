#!/bin/zsh
# 复用历史入口及退出行为；绝对脚本路径由 zsh 解析符号链接。
exec "${0:A:h}/../xcode/启动 XCode.command" "$@"
