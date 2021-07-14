#!/bin/bash

set -ex
srcdir=`dirname $0`/../..
srcdir=`realpath $srcdir`
cd $srcdir 

docker build -f docker/Dockerfile -t localhost/almond-cloud .
docker build -f tests/thingpedia-integration/Dockerfile -t localhost/almond-test .
kind create cluster --config=$srcdir/tests/thingpedia-integration/k8s/cluster.yaml
kind load docker-image localhost/almond-cloud
kind load docker-image localhost/almond-test
kustomize build $srcdir/tests/thingpedia-integration/k8s/database | kubectl apply -f -
kubectl wait --timeout=120s --for=condition=complete  job/create-db
kustomize build $srcdir/tests/thingpedia-integration/k8s | kubectl apply -f -
kubectl wait --timeout=120s --for=condition=Available  deployment/frontend