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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>


import assert from 'assert';
import { assertHttpError, assertRedirect, assertLoginRequired, sessionRequest, dbQuery } from './scaffold';
import { login, startSession } from '../login';

import * as db from '../../src/util/db';
import * as EngineManager from '../../src/almond/enginemanagerclient';

import * as Config from '../../src/config';

async function testMyStuff(bob, nobody) {
    await assertRedirect(sessionRequest('/me', 'GET', null, nobody, { followRedirects: false }), '/user/login');

    await assertLoginRequired(sessionRequest('/me', 'POST', { command: 'show me the cat pictures' }, nobody));
    await assertLoginRequired(sessionRequest('/me', 'POST', {}, nobody));

    await assertHttpError(sessionRequest('/me', 'POST', {}, bob),
        400, 'Missing or invalid parameter command');

    let response = await sessionRequest('/me', 'POST', { command: 'show me the cat pictures' }, bob);
    assert(response.indexOf('value="show me the cat pictures"') >= 0);

    response = await sessionRequest('/me', 'POST', { command: '<script>evil()</script>' }, bob);
    assert(response.indexOf('<script>evil()</script>') < 0);

    await assertRedirect(sessionRequest('/me/conversation', 'GET', null, nobody, { followRedirects: false }), '/user/login');

    await assertLoginRequired(sessionRequest('/me/conversation', 'POST', { command: 'show me the cat pictures' }, nobody));

    await assertHttpError(sessionRequest('/me/conversation', 'POST', {}, bob),
        400, 'Missing or invalid parameter command');

    response = await sessionRequest('/me/conversation', 'POST', { command: 'show me the cat pictures' }, bob);
    assert(response.indexOf('value="show me the cat pictures"') >= 0);
}

async function testMyDevices(bob, nobody) {
    await assertRedirect(sessionRequest('/me/devices/create', 'GET', {}, nobody, { followRedirects: false }), '/user/login');

    // no need to test the non-error case for /me/devices, linkchecker does that

    await assertLoginRequired(sessionRequest('/me/devices/create', 'POST', { kind: 'com.nytimes' }, nobody));

    await assertHttpError(sessionRequest('/me/devices/create', 'POST', { kind: '' }, bob),
        400, 'Missing or invalid parameter kind');
    await assertHttpError(sessionRequest('/me/devices/create', 'POST', { kind: '' }, bob),
        400, 'Missing or invalid parameter kind');
    await assertHttpError(sessionRequest('/me/devices/create', 'POST', { kind: 'com.foo', invalid: [1, 2] }, bob),
        400, 'Missing or invalid parameter invalid');
    await assertHttpError(sessionRequest('/me/devices/create', 'POST', { kind: 'com.foo' }, bob),
        400, 'Unexpected HTTP error 404');

    if (Config.WITH_THINGPEDIA === 'external') {
        await assertRedirect(sessionRequest('/me/devices/create', 'POST', {
            kind: 'org.thingpedia.rss',
            url: 'https://almond.stanford.edu/blog/feed.rss',
            name: 'almond blog',
        }, bob, { followRedirects: false }), '/me');

        // FIXME there should be a /me/api to list devices
        const [bobInfo] = await dbQuery(`select * from users where username = ?`, ['bob']);
        assert(bobInfo);
        const engine = await EngineManager.get().getEngine(bobInfo.id);
        const device = await engine.getDeviceInfo('org.thingpedia.rss-name:almond blog-url:https://almond.stanford.edu/blog/feed.rss');
        assert(device);

        await assertLoginRequired(sessionRequest('/me/devices/delete', 'POST', { id: 'foo' }, nobody));

        await assertHttpError(sessionRequest('/me/devices/delete', 'POST', { id: '' }, bob),
            400, 'Missing or invalid parameter id');

        await assertHttpError(sessionRequest('/me/devices/delete', 'POST', { id: 'com.foo' }, bob),
            404, 'Not found.');

        await sessionRequest('/me/devices/delete', 'POST', { id: 'org.thingpedia.rss-name:almond blog-url:https://almond.stanford.edu/blog/feed.rss' }, bob);

        assert(!await engine.hasDevice('org.thingpedia.rss-name:almond blog-url:https://almond.stanford.edu/blog/feed.rss'));


        await assertLoginRequired(sessionRequest('/me/devices/oauth2/com.linkedin', 'POST', { id: 'foo' }, nobody));

        await assertHttpError(sessionRequest('/me/devices/oauth2/com.foo', 'GET', null, bob),
            400, 'Unexpected HTTP error 404');
        await assertHttpError(sessionRequest('/me/devices/oauth2/com.thecatapi', 'GET', null, bob),
            400, 'this.runOAuth2 is not a function');
    }
}

async function main() {
    const emc = EngineManager.get();
    await emc.start();

    const nobody = await startSession();
    const bob = await login('bob', '12345678');

    // user pages
    await testMyStuff(bob, nobody);
    await testMyDevices(bob, nobody);

    await db.tearDown();
    await emc.stop();
}
export default main;
if (!module.parent)
    main();
