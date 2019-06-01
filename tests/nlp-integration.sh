#!/bin/bash

## Integration tests for the NLP components (training, inference)

set -e
set -x
set -o pipefail

srcdir=`dirname $0`/..
srcdir=`realpath $srcdir`

DATABASE_URL="mysql://thingengine:thingengine@localhost/thingengine_test"
export DATABASE_URL
AES_SECRET_KEY=80bb23f93126074ba01410c8a2278c0c
export AES_SECRET_KEY
JWT_SIGNING_KEY="not so secret key"
export JWT_SIGNING_KEY
SECRET_KEY="not so secret key"
export SECRET_KEY

export THINGENGINE_USE_TOKENIZER=local
export GENIE_USE_TOKENIZER=local

NLP_PORT=${NLP_PORT:-8400}
TRAINING_PORT=${TRAINING_PORT:-8090}
cat > $srcdir/secret_config.js <<EOF
module.exports.NL_SERVER_URL = 'http://127.0.0.1:${NLP_PORT}';
module.exports.TRAINING_URL = 'http://127.0.0.1:${TRAINING_PORT}';
module.exports.FILE_STORAGE_BACKEND = 'local';
module.exports.CDN_HOST = '/download';
module.exports.WITH_THINGPEDIA = 'external';
module.exports.THINGPEDIA_URL = 'https://almond-dev.stanford.edu/thingpedia';
module.exports.ENABLE_PROMETHEUS = true;
module.exports.PROMETHEUS_ACCESS_TOKEN = 'my-prometheus-access-token';
module.exports.DISCOURSE_SSO_SECRET = 'd836444a9e4084d5b224a60c208dce14';
EOF

workdir=`mktemp -t -d almond-nlp-integration-XXXXXX`
workdir=`realpath $workdir`
on_error() {
    test -n "$inferpid" && kill $inferpid
    inferpid=
    test -n "$tokenizerpid" && kill $tokenizerpid
    tokenizerpid=
    wait

    cd $oldpwd
    rm -fr $workdir
}
trap on_error ERR INT TERM

oldpwd=`pwd`
cd $workdir

node $srcdir/tests/mock-tokenizer.js &
tokenizerpid=$!

# clean the database and bootstrap
$srcdir/scripts/execute-sql-file.js $srcdir/model/schema.sql
node $srcdir/scripts/bootstrap.js

mkdir -p 'default:en'
mkdir -p 'contextual:en'

wget --no-verbose -c https://parmesan.stanford.edu/test-models/default/en/current.tar.gz -O $srcdir/tests/embeddings/current.tar.gz
tar xvf $srcdir/tests/embeddings/current.tar.gz -C 'default:en'

wget --no-verbose -c https://parmesan.stanford.edu/test-models/default/en/current-contextual.tar.gz -O $srcdir/tests/embeddings/current-contextual.tar.gz
tar xvf $srcdir/tests/embeddings/current-contextual.tar.gz -C 'contextual:en'

wget --no-verbose -c https://parmesan.stanford.edu/test-models/default/en/classifier.h5 -O en.classifier.h5

PORT=$NLP_PORT node $srcdir/nlp/main.js &
inferpid=$!

# in interactive mode, sleep forever
# the developer will run the tests by hand
# and Ctrl+C
if test "$1" = "--interactive" ; then
    sleep 84600
else
    # sleep until the process is settled
    sleep 30

    node $srcdir/tests/nlp
fi

kill $inferpid
inferpid=
kill $tokenizerpid
tokenizerpid=
wait

cd $oldpwd
rm -fr $workdir
