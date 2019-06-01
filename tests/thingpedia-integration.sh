#!/bin/bash

## Integration tests for the embedded Thingpedia
## (API, web pages)

set -e
set -x
set -o pipefail

srcdir=`dirname $0`/..
srcdir=`realpath $srcdir`

PORT=${PORT:-8080}
cat > $srcdir/secret_config.js <<EOF
module.exports.DATABASE_URL="mysql://thingengine:thingengine@localhost/thingengine_test";
module.exports.SERVER_ORIGIN = 'http://127.0.0.1:${PORT}';
module.exports.FILE_STORAGE_BACKEND = 'local';
module.exports.CDN_HOST = '/download';
module.exports.WITH_THINGPEDIA = 'embedded';
module.exports.THINGPEDIA_URL = '/thingpedia';
module.exports.ENABLE_PROMETHEUS = true;
module.exports.PROMETHEUS_ACCESS_TOKEN = 'my-prometheus-access-token';
module.exports.DISCOURSE_SSO_SECRET = 'd836444a9e4084d5b224a60c208dce14';
module.exports.AES_SECRET_KEY = '80bb23f93126074ba01410c8a2278c0c';
module.exports.JWT_SIGNING_KEY = "not so secret key" ;
module.exports.SECRET_KEY = "not so secret key";
module.exports.NL_SERVER_URL = "https://almond-dev.stanford.edu/nnparser";
module.exports.SUPPORTED_LANGUAGES = ['en-US', 'it-IT', 'zh-CN', 'zh-TW'];
EOF

workdir=`mktemp -t -d webalmond-integration-XXXXXX`
workdir=`realpath $workdir`
on_error() {
    test -n "$frontendpid" && kill $frontendpid
    frontendpid=
    test -n "$masterpid" && kill $masterpid
    masterpid=
    wait

    rm -fr $workdir
}
trap on_error ERR INT TERM

oldpwd=`pwd`
cd $workdir

# set up download directories
mkdir -p $srcdir/public/download
for x in devices icons backgrounds blog-assets ; do
    mkdir -p $workdir/shared/$x
    ln -sf -T $workdir/shared/$x $srcdir/public/download/$x
done
mkdir -p $workdir/shared/cache
echo '{"tt:stock_id:goog": "fb80c6ac2685d4401806795765550abdce2aa906.png"}' > $workdir/shared/cache/index.json

# clean the database and bootstrap
# (this has to occur after setting up the download
# directories because it copies the icon png files)
$srcdir/scripts/execute-sql-file.js $srcdir/model/schema.sql
node $srcdir/scripts/bootstrap.js

# load some more data into Thingpedia
test -f $srcdir/tests/data/com.bing.zip || wget https://thingpedia.stanford.edu/thingpedia/download/devices/com.bing.zip -O $srcdir/tests/data/com.bing.zip
eval $(node $srcdir/tests/load_test_thingpedia.js)

node $srcdir/frontend.js &
frontendpid=$!

# in interactive mode, sleep forever
# the developer will run the tests by hand
# and Ctrl+C
if test "$1" = "--interactive" ; then
    sleep 84600
else
    # sleep until the process is settled
    sleep 30

    node $srcdir/tests/test_thingpedia_api_v1_v2.js

    # login as bob
    bob_cookie=$(node $srcdir/tests/login.js bob 12345678)

    COOKIE="${bob_cookie}" node $srcdir/tests/test_thingpedia_api_v3.js
fi

kill $frontendpid
frontendpid=
wait

# now enable the Stanford pages and run the website again
echo "Object.assign(module.exports, require('./stanford/config.js'));" >> $srcdir/secret_config.js

# the website crawler tests will touch the web almond pages
# too, so make sure we don't die with 400 or 500 because Almond is off
# we have just tested operation without web almond anyway
export THINGENGINE_DISABLE_SYSTEMD=1
node $srcdir/almond/master.js &
masterpid=$!

node $srcdir/frontend.js &
frontendpid=$!

if test "$1" = "--webalmond-interactive" ; then
    sleep 84600
else
    # sleep until the process is settled
    sleep 30
    # run the website tests from web almond, this time with Thingpedia + Stanford
    # enabled

    # login as bob
    bob_cookie=$(node $srcdir/tests/login.js bob 12345678)
    # login as root
    root_cookie=$(node $srcdir/tests/login.js root rootroot)

    # run the automated link checker
    # first without login
    node $srcdir/tests/linkcheck.js
    # then as bob (developer)
    COOKIE="${bob_cookie}" node $srcdir/tests/linkcheck.js
    # then as root (admin)
    COOKIE="${root_cookie}" node $srcdir/tests/linkcheck.js

    # test the website by making HTTP requests directly
    node $srcdir/tests/website

    # test the website in a browser
    SELENIUM_BROWSER=firefox node $srcdir/tests/test_website_selenium.js
fi

kill $frontendpid
frontendpid=
kill $masterpid
masterpid=
wait

# Now tests that we can update the datasets

# first compile the PPDB
node $srcdir/node_modules/.bin/genie compile-ppdb $srcdir/tests/data/ppdb-2.0-xs-lexical -o $workdir/ppdb-2.0-xs-lexical.bin

# now generate the dataset (which will be saved to mysql)
node $srcdir/training/update-dataset.js -l en -a --maxdepth 3 --ppdb $workdir/ppdb-2.0-xs-lexical.bin --debug

# download and check
node $srcdir/training/download-dataset.js -l en --no-quote-free --train train-quoted.tsv --eval eval-quoted.tsv --eval-probability 1.0
node $srcdir/training/download-dataset.js -l en --quote-free --train train-quote-free.tsv --eval eval-quote-free.tsv --eval-probability 1.0

sha256sum train-quoted.tsv eval-quoted.tsv train-quote-free.tsv eval-quote-free.tsv
sha256sum -c <<EOF
478b98d61a37142174a4f6d55761f5cbbd9d2553aebd0fcdcd3d359642026aa2  train-quoted.tsv
5e8070f97c52581c51ab58736d126e2d8e11adaf8b5737d03b672ac8cec38285  eval-quoted.tsv
615c9b6ffeaa50510f60020c87e649e56e3bc9530df45f5803231b63c8a9c40d  train-quote-free.tsv
f921f152ad30fe768de300d0ec2a796ebccc24775f567e97e6783185fcacac46  eval-quote-free.tsv
EOF

# now regenerate the dataset incrementally
node $srcdir/training/update-dataset.js -l en --device com.bing --maxdepth 3 --ppdb $workdir/ppdb-2.0-xs-lexical.bin --debug

rm -rf $workdir
