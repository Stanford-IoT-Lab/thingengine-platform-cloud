#!/bin/bash
set -ex
srcdir=`dirname $0`/../..
srcdir=`realpath $srcdir`
cd $srcdir 

# Run thingpedia-integration test inside frontend pod
POD=`kubectl get pod -l app=frontend -o jsonpath="{.items[0].metadata.name}"`
kubectl exec $POD --  bash -c "cd /opt/almond-cloud && npx nyc tests/thingpedia-integration/thingpedia-integration.sh"

# Run selenium test on ubuntu with Firefox installed
THINGENGINE_CONFIGDIR=tests/thingpedia-integration/k8s npx nyc ts-node tests/test_website_selenium.js

# kill frontend to generate coverage outputs
kubectl exec $POD -- bash -c 'kill $(cat /home/almond-cloud/pid)'
sleep 2

# Copy coverage outputs
kubectl cp $POD:/opt/almond-cloud/.nyc_output .nyc_output

# kill backend to generate coverage outputs
kubectl exec shared-backend-0 -- bash -c 'kill $(cat /home/almond-cloud/pid)'
sleep 2

# Copy coverage outputs
kubectl cp shared-backend-0:/opt/almond-cloud/.nyc_output .nyc_output