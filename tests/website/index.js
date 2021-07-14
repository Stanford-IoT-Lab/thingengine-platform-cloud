// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

import * as fs from 'fs';

process.on('unhandledRejection', (up) => { throw up; });
import '../../src/util/config_init';
process.env.TEST_MODE = '1';

import * as Config from '../../src/config';
import * as EngineManager from '../../src/almond/enginemanagerclient';

/*async function par(array) {
    await Promise.all(array.map((fn) => fn()));
}*/
async function seq(array) {
    for (let fn of array) {
        if (fn === null)
            continue;
        console.log(`Running tests for ${fn}`);
        await (await import(fn)).default();
    }
}

function inCluster() {
    const path = '/var/run/secrets/kubernetes.io/serviceaccount/namespace';
    try {
        if (fs.existsSync(path))
            return true;
    } catch(err) {
        return false;
    }
    return false;
}

EngineManager.init(inCluster());

seq([
    ('./test_public_endpoints'),
    ('./test_register'),
    ('./test_sso'),
    ('./test_me'),
    ('./test_my_api'),
    ('./test_admin'),
    Config.WITH_THINGPEDIA === 'external' ? ('./test_oauth_proxy') : null,
    Config.WITH_THINGPEDIA === 'embedded' ? ('./test_oauth') : null,
    Config.WITH_THINGPEDIA === 'embedded' ? ('./test_string_entities') : null,

    Config.WITH_THINGPEDIA === 'embedded' ? ('./test_mturk') : null,
]);
