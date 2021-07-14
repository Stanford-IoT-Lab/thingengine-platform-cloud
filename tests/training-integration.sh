#!/bin/bash

## Integration tests for the automatic training server

set -e
set -x
set -o pipefail

srcdir=`dirname $0`/..
srcdir=`realpath $srcdir`

workdir=`mktemp -t -d webalmond-integration-XXXXXX`
workdir=`realpath $workdir`
on_error() {
    test -n "$serverpid" && kill $serverpid
    serverpid=
    test -n "$frontendpid" && kill $frontendpid
    frontendpid=
    wait

    rm -fr $workdir
    rm -f $srcdir/secret_config.js
}
trap on_error ERR INT TERM

oldpwd=`pwd`
cd $workdir

# remove stale config files
rm -f $srcdir/secret_config.js

mkdir -p $workdir/etc/config.d
export THINGENGINE_CONFIGDIR=$workdir/etc
PORT=${PORT:-8090}
cat > ${THINGENGINE_CONFIGDIR}/config.yaml <<EOF
DATABASE_URL: "mysql://thingengine:thingengine@localhost/thingengine_test"
SERVER_ORIGIN: "http://127.0.0.1:8080"
FILE_STORAGE_BACKEND: local
CDN_HOST: /download
WITH_THINGPEDIA: embedded
WITH_LUINET: embedded
THINGPEDIA_URL: /thingpedia
DOCUMENTATION_URL: /doc/getting-started.md
ENABLE_DEVELOPER_PROGRAM: true
ENABLE_PROMETHEUS: true
PROMETHEUS_ACCESS_TOKEN: my-prometheus-access-token
DISCOURSE_SSO_SECRET: d836444a9e4084d5b224a60c208dce14
AES_SECRET_KEY: 80bb23f93126074ba01410c8a2278c0c
JWT_SIGNING_KEY: "not so secret key"
SECRET_KEY: "not so secret key"
NL_SERVER_URL: null
NL_MODEL_DIR: ./models
TENSORBOARD_DIR: ./tensorboard
TRAINING_URL: "http://127.0.0.1:${PORT}"
TRAINING_ACCESS_TOKEN: test-training-access-token
TRAINING_MEMORY_USAGE: 1000
SUPPORTED_LANGUAGES: ['en-US']
EOF

# set up download directories
mkdir -p $workdir/shared/download
for x in devices icons backgrounds blog-assets template-files/en ; do
    mkdir -p $workdir/shared/download/$x
done
mkdir -p $workdir/shared/cache
mkdir -p $workdir/exact
mkdir -p $workdir/models
echo '{"tt:stock_id:goog": "fb80c6ac2685d4401806795765550abdce2aa906.png"}' > $workdir/shared/cache/index.json

# clean the database and bootstrap
# (this has to occur after setting up the download
# directories because it copies the icon png files)
${srcdir}/dist/main.js bootstrap --force

# load some more data into Thingpedia
test -f $srcdir/tests/data/com.bing.zip || wget https://thingpedia.stanford.edu/thingpedia/api/v3/devices/package/com.bing -O $srcdir/tests/data/com.bing.zip
eval $(ts-node $srcdir/tests/load_test_thingpedia.ts)

# set the config on all models
tr -d '\n' > training-config.json <<EOF
{
"synthetic_depth": 3,
"dataset_target_pruning_size": 1000,
"dataset_contextual_target_pruning_size": 1000,
"dataset_quoted_probability": 0.1,
"dataset_eval_probability": 0.5,
"dataset_split_strategy": "sentence",
"train_iterations": 12,
"save_every": 6,
"val_every": 3,
"log_every": 3,
"train_batch_tokens": 100,
"val_batch_size": 100,
"model": "TransformerSeq2Seq",
"pretrained_model": "sshleifer/bart-tiny-random",
"warmup": 40,
"lr_multiply": 0.01
}
EOF

cat training-config.json

${srcdir}/dist/main.js execute-sql-file /proc/self/fd/0 <<<"update models set contextual = false, config = '$(cat training-config.json)';"

${srcdir}/dist/main.js run-frontend &
frontendpid=$!
${srcdir}/dist/main.js run-training &
serverpid=$!

# in interactive mode, sleep forever
# the developer will run the tests by hand
# and Ctrl+C
if test "$1" = "--interactive" ; then
    sleep 84600
else
    # sleep until the process is settled
    sleep 30

    ts-node $srcdir/tests/training
fi

kill $serverpid
serverpid=
kill $frontendpid
frontendpid=
wait


rm -rf $workdir
rm -f $srcdir/secret_config.js
