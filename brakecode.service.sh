#!/bin/bash
NODE_BINARY=$(which node)
NODE_VERSION=$($NODE_BINARY -v)

rm brakecode.service

sudo cat << HERE > brakecode.service
[Unit]
Description=agent.js - Make remote debugging possible via secure web socket tunneling
Documentation=https://brakecode.com
After=network.target

[Service]
Type=simple
User=ubuntu
ExecStart=$NODE_BINARY /home/ubuntu/.nvm/versions/node/$NODE_VERSION/lib/node_modules/brakecode/agent.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
HERE

sudo mv brakecode.service /lib/systemd/system/brakecode.service
ln -s /lib/systemd/system/brakecode.service
