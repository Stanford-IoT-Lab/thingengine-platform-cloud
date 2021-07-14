#!/bin/bash
set -ex

cd /home/almond-cloud
/opt/almond-cloud/dist/main.js "$@" &
pid=$!
echo $pid > /home/almond-cloud/pid
wait $pid