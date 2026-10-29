#!/bin/zsh
export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
/opt/homebrew/bin/python3 "${0:A:h}/start-local.py"
result=$?
if (( result != 0 )) && [[ -t 0 ]]; then
  printf '\n按回车关闭；已有服务不会停止。'
  read -r
fi
exit $result
