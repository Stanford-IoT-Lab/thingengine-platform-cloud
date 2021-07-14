// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
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
import FormData from 'form-data';
import { assertHttpError, assertRedirect, assertLoginRequired, assertBlocked, sessionRequest, dbQuery } from './scaffold';
import { login, startSession } from '../login';

import * as db from '../../src/util/db';
import sleep from '../../src/util/sleep';
import * as EngineManager from '../../src/almond/enginemanagerclient';

import * as Config from '../../src/config';

async function testAdminUsers(root, bob, nobody) {
    await assertBlocked('/admin/users', bob, nobody);
    const usersPage = await sessionRequest('/admin/users', 'GET', null, root);
    assert(usersPage.indexOf('bob@localhost') >= 0);
    assert(usersPage.indexOf('root@localhost') >= 0);
    const usersPage2 = await sessionRequest('/admin/users', 'GET', { page: -1 }, root);
    assert(usersPage2.indexOf('bob@localhost') >= 0);
    assert(usersPage2.indexOf('root@localhost') >= 0);

    const nextUserPage = await sessionRequest('/admin/users', 'GET', { page: 1 }, root);
    assert(nextUserPage.indexOf('bob@localhost') < 0);
    assert(nextUserPage.indexOf('root@localhost') < 0);

    await assertBlocked('/admin/users/search', bob, nobody);
    await assertHttpError(sessionRequest('/admin/users/search', 'GET', null, root),
        400, 'Missing or invalid parameter q');
    const rootUserPage = await sessionRequest('/admin/users/search', 'GET', { q: 'root' }, root);
    assert(rootUserPage.indexOf('bob@localhost') < 0);
    assert(rootUserPage.indexOf('root@localhost') >= 0);

    const rootUserPage2 = await sessionRequest('/admin/users/search', 'GET', { q: '1' }, root);
    assert(rootUserPage2.indexOf('bob@localhost') < 0);
    assert(rootUserPage2.indexOf('root@localhost') >= 0);
}

async function testAdminKillRestart(root, bob, nobody) {
    const emc = EngineManager.get();
    assert(await emc.getEngine(1));
    assert(await emc.isRunning(1)); // root
    assert(await emc.getEngine(2));
    assert(await emc.isRunning(2)); // anonymous
    assert(await emc.getEngine(3));
    assert(await emc.isRunning(3)); // bob
    assert(await emc.getEngine(4));
    assert(await emc.isRunning(4)); // david
    assert(await emc.getEngine(5));
    assert(await emc.isRunning(5)); // emma -or- alexa_user

    // /kill/all is very aggressive, and kills also the shared processes (it's sort of a killswitch for
    // when things go awry, short of "systemctl stop thingengine-cloud@.service"
    // hence, after we run it, we sleep for a couple seconds so that the shared processes restart
    await assertLoginRequired(sessionRequest('/admin/users/kill/all', 'POST', '', nobody));
    await assertRedirect(sessionRequest('/admin/users/kill/all', 'POST', '', root, { followRedirects: false }), '/admin/users');

    assert(!await emc.isRunning(1)); // root
    assert(!await emc.isRunning(2)); // anonymous
    assert(!await emc.isRunning(3)); // bob
    assert(!await emc.isRunning(4)); // david
    assert(!await emc.isRunning(5)); // emma -or- alexa_user


    await assertLoginRequired(sessionRequest('/admin/users/start/1', 'POST', '', nobody));
    await assertRedirect(sessionRequest('/admin/users/start/1', 'POST', '', root, { followRedirects: false }), '/admin/users/search?q=1');

    // wait for user to start
    await sleep(5000);
    assert(await emc.isRunning(1)); // root
    assert(!await emc.isRunning(3)); // bob

    // try connecting to /me/status from bob, this should not fail even though bob is not running
    await sessionRequest('/me/status', 'GET', '', bob);

    // start everybody else too
    await sessionRequest('/admin/users/start/2', 'POST', '', root);
    await sessionRequest('/admin/users/start/3', 'POST', '', root);
    await sessionRequest('/admin/users/start/4', 'POST', '', root);
    await sessionRequest('/admin/users/start/5', 'POST', '', root);

    await sleep(5000);
    assert(await emc.isRunning(2)); // anonymous
    assert(await emc.isRunning(3)); // bob
    assert(await emc.isRunning(4)); // david
    assert(await emc.isRunning(5)); // emma -or- alexa_user

    // kill root
    await assertLoginRequired(sessionRequest('/admin/users/kill/1', 'POST', '', nobody));
    await assertRedirect(sessionRequest('/admin/users/kill/1', 'POST', '', root, { followRedirects: false }), '/admin/users/search?q=1');

    assert(!await emc.isRunning(1)); // root
    assert(await emc.isRunning(2)); // anonymous
    assert(await emc.isRunning(3)); // bob
    assert(await emc.isRunning(4)); // david
    assert(await emc.isRunning(5)); // emma -or- alexa_user


    await sessionRequest('/admin/users/start/1', 'POST', '', root);
    await sleep(5000);
    assert(await emc.isRunning(1));

    // noop
    await sessionRequest('/admin/users/start/1', 'POST', '', root);
    assert(await emc.isRunning(1));
}

async function testAdminOrgs(root, bob, nobody) {
    await assertBlocked('/admin/organizations', bob, nobody);
    const orgsPage = await sessionRequest('/admin/organizations', 'GET', null, root);
    assert(orgsPage.indexOf('Test Org') >= 0);
    assert(orgsPage.indexOf('Site Administration') >= 0);
    const orgsPage2 = await sessionRequest('/admin/organizations', 'GET', { page: -1 }, root);
    assert(orgsPage2.indexOf('Test Org') >= 0);
    assert(orgsPage2.indexOf('Site Administration') >= 0);

    const nextOrgPage = await sessionRequest('/admin/organizations', 'GET', { page: 1 }, root);
    assert(nextOrgPage.indexOf('Test Org') < 0);
    assert(nextOrgPage.indexOf('Site Administration') < 0);

    await assertBlocked('/admin/users/search', bob, nobody);
    await assertHttpError(sessionRequest('/admin/organizations/search', 'GET', null, root),
        400, 'Missing or invalid parameter q');
    const rootOrgPage = await sessionRequest('/admin/organizations/search', 'GET', { q: 'site' }, root);
    assert(rootOrgPage.indexOf('Test Org') < 0);
    assert(rootOrgPage.indexOf('Site Administration') >= 0);

    await assertLoginRequired(sessionRequest('/admin/organizations/add-member', 'POST', '', nobody));
    await assertHttpError(sessionRequest('/admin/organizations/add-member', 'POST', '', bob),
            403, 'You do not have permission to perform this operation.');
    await assertHttpError(sessionRequest('/admin/organizations/add-member', 'POST', { id: '1.5' }, root),
            400, 'Missing or invalid parameter id');
    await assertHttpError(sessionRequest('/admin/organizations/add-member', 'POST', { id: '2' }, root),
            400, 'Missing or invalid parameter username');
    await assertHttpError(sessionRequest('/admin/organizations/add-member', 'POST', { id: '2', username: 'non-existent' }, root),
            400, 'No such user non-existent');
    await assertHttpError(sessionRequest('/admin/organizations/add-member', 'POST', { id: '2', username: 'root' }, root),
            400, 'root is already a member of another developer organization.');

    await sessionRequest('/admin/organizations/add-member', 'POST', { id: '2', username: 'david' }, root);

    let [davidInfo] = await dbQuery(`select * from users where username = ?`, ['david']);
    assert(davidInfo);
    assert.strictEqual(davidInfo.developer_org, 2);
    assert.strictEqual(davidInfo.developer_status, 0);

    // now undo the change (mostly so you can run the tests multiple times against the same database)
    await sessionRequest('/admin/users/revoke-developer/' + davidInfo.id, 'POST', '', root);

    [davidInfo] = await dbQuery(`select * from users where username = ?`, ['david']);
    assert(davidInfo);
    assert.strictEqual(davidInfo.developer_org, null);
    assert.strictEqual(davidInfo.developer_status, 0);
}

async function testAdminBlog(root, bob, nobody) {
    await assertBlocked('/admin/blog', bob, nobody);
    await assertBlocked('/admin/blog/create', bob, nobody);
    await assertBlocked('/admin/blog/update/1', bob, nobody);

    await assertHttpError(sessionRequest('/admin/blog/update/1', 'GET', '', root),
            404, 'The requested page does not exist.');

    await assertHttpError(sessionRequest('/admin/blog/create', 'POST', { title: 'Some blog post' }, root),
            400, 'Missing or invalid parameter image');
    await assertHttpError(sessionRequest('/admin/blog/create', 'POST', { title: 'Some blog post', image: 'no' }, root),
            400, 'Missing or invalid parameter blurb');
    await assertRedirect(sessionRequest('/admin/blog/create', 'POST', {
        title: 'Some blog post',
        image: 'no',
        blurb: 'this is a blog post that does blogging',
        source: '# Heading\n## Subheading \n',
    }, root, { followRedirects: false }), '/admin/blog/update/1');

    const blogPostPage = await sessionRequest('/blog/1-some-blog-post', 'GET', '', root);

    assert(blogPostPage.indexOf('Some blog post') >= 0);
    assert(blogPostPage.indexOf('<h1 id="heading" tabindex="-1">Heading</h1>') >= 0);
    assert(blogPostPage.indexOf('<h2 id="subheading" tabindex="-1">Subheading</h2>') >= 0);
    // FIXME
    //assert(blogPostPage.indexOf('<script type="dangerous">much script very bad</script>') < 0);

    // blog post is not published yet, people should not see it
    await assertHttpError(sessionRequest('/blog/1-some-blog-post', 'GET', '', nobody),
            404, 'The requested page does not exist.');
    await assertHttpError(sessionRequest('/blog/1-some-blog-post', 'GET', '', bob),
            404, 'The requested page does not exist.');

    await sessionRequest('/admin/blog/delete', 'POST', { id: 1 }, root);
}

async function testAdminFileUpload(root, bob) {
    const fd1 = new FormData();
    fd1.append('file', 'Test file\n', { filename: 'test.txt', contentType: 'text/plain;charset=utf8' });
    await assertHttpError(sessionRequest('/admin/blog/upload', 'POST', fd1, bob),
        403, 'You do not have permission to perform this operation.');

    const fd2 = new FormData();
    fd2.append('file', 'Test file\n', { filename: 'test.txt', contentType: 'text/plain;charset=utf8' });
    const response = JSON.parse(await sessionRequest('/admin/blog/upload', 'POST', fd2, root));
    assert.deepStrictEqual(response, {
        result: 'ok',
        filename: '377e7167ebfda22e89011fadc436fe5086ee98c3'
    });

    const fd3 = new FormData();
    await assertHttpError(sessionRequest('/admin/blog/upload', 'POST', fd3, root),
        400, 'missing file');

    const fd4 = new FormData();
    fd4.append('file', 'Not actually a file');
    await assertHttpError(sessionRequest('/admin/blog/upload', 'POST', fd4, root),
        400, 'missing file');

    const fd5 = new FormData();
    fd5.append('file', 'Test file\n', { filename: 'test.txt', contentType: 'text/plain;charset=utf8' });
    fd5.append('file', 'Another file', { filename: 'test2.txt', contentType: 'text/plain;charset=utf8' });
    await assertHttpError(sessionRequest('/admin/blog/upload', 'POST', fd5, root),
        400, 'Unexpected field');

    const fd6 = new FormData();
    fd6.append('file', 'Test file\n', { filename: 'test.txt', contentType: 'text/plain;charset=utf8' });
    fd6.append('file2', 'Another file', { filename: 'test2.txt', contentType: 'text/plain;charset=utf8' });
    await assertHttpError(sessionRequest('/admin/blog/upload', 'POST', fd6, root),
        400, 'Unexpected field');
}

async function main() {
    const emc = EngineManager.get();
    await emc.start();

    const nobody = await startSession();
    const bob = await login('bob', '12345678');
    const root = await login('root', 'rootroot');

    // admin pages
    await assertBlocked('/admin', bob, nobody);
    await sessionRequest('/admin', 'GET', null, root);

    await testAdminUsers(root, bob, nobody);
    await testAdminKillRestart(root, bob, nobody);
    if (Config.WITH_THINGPEDIA === 'embedded')
        await testAdminOrgs(root, bob, nobody);
    await testAdminBlog(root, bob, nobody);
    await testAdminFileUpload(root, bob);

    await db.tearDown();
    await emc.stop();
}
export default main;
if (!module.parent)
    main();
