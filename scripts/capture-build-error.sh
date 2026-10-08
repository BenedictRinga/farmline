#!/usr/bin/env bash
export PATH=/home/appuser/.nvm/versions/node/v20.18.3/bin:$PATH
cd /opt/farmline-app
sudo -u appuser yarn build:prod > /tmp/farmline-build.log 2>&1
echo "exit:$?"
grep -nE "Error|ERROR|error TS|✘|Cannot find|is not" /tmp/farmline-build.log | head -10
tail -4 /tmp/farmline-build.log