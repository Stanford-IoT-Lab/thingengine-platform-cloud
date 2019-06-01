// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond Cloud
//
// Copyright 2018 Google LLC
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

require('thingengine-core/lib/polyfill');
process.on('unhandledRejection', (up) => { throw up; });
require('../util/config_init');

const assert = require('assert');
const path = require('path');
const util = require('util');
const fs = require('fs');
const yaml = require('js-yaml');

const db = require('../util/db');
const userModel = require('../model/user');
const organization = require('../model/organization');
const entityModel = require('../model/entity');
const exampleModel = require('../model/example');

const user = require('../util/user');
const Importer = require('../util/import_device');
const { makeRandom } = require('../util/random');
const TokenizerService = require('../util/tokenizer_service');

const platform = require('../util/platform');

const Config = require('../config');
assert.strictEqual(Config.WITH_THINGPEDIA, 'embedded');

const req = { _(x) { return x; } };

async function loadManifest(primaryKind) {
    const filename = path.resolve(path.dirname(module.filename), './data/' + primaryKind + '.yaml');
    return yaml.safeLoad((await util.promisify(fs.readFile)(filename)).toString(), { filename });
}

async function loadAllDevices(dbClient, bob, root) {
    // "login" as bob
    req.user = bob;

    const invisible = await loadManifest('org.thingpedia.builtin.test.invisible');
    await Importer.importDevice(dbClient, req, 'org.thingpedia.builtin.test.invisible', invisible, {
        owner: req.user.developer_org,
        iconPath: path.resolve(path.dirname(module.filename), '../data/org.thingpedia.builtin.thingengine.builtin.png'),
        approve: false
    });

    const bing = await loadManifest('com.bing');
    await Importer.importDevice(dbClient, req, 'com.bing', bing, {
        owner: req.user.developer_org,
        zipFilePath: path.resolve(path.dirname(module.filename), './data/com.bing.zip'),
        iconPath: path.resolve(path.dirname(module.filename), './data/com.bing.png'),
        approve: true
    });

    // now "login" as root
    req.user = root;

    const adminonly = await loadManifest('org.thingpedia.builtin.test.adminonly');
    await Importer.importDevice(dbClient, req, 'org.thingpedia.builtin.test.adminonly', adminonly, {
        owner: req.user.developer_org,
        iconPath: path.resolve(path.dirname(module.filename), '../data/org.thingpedia.builtin.thingengine.builtin.png'),
        approve: false
    });

    await db.query(dbClient, `insert into device_class_tag(device_id,tag) select id,'featured' from device_class where primary_kind in ('com.bing', 'org.thingpedia.builtin.thingengine.phone')`);
}

async function loadEntityValues(dbClient) {
    await entityModel.createMany(dbClient, [{
        id: 'tt:stock_id',
        name: 'Company Stock ID',
        language: 'en',
        is_well_known: false,
        has_ner_support: true,
    }]);

    await db.insertOne(dbClient,
        `insert ignore into entity_lexicon(language,entity_id,entity_value,
        entity_canonical,entity_name) values ?`,
         [[
         ['en', 'org.freedesktop:app_id', 'edu.stanford.Almond', 'almond', 'Almond'],
         ['en', 'org.freedesktop:app_id', 'org.gnome.Builder', 'gnome builder', 'GNOME Builder'],
         ['en', 'org.freedesktop:app_id', 'org.gnome.Weather.Application', 'gnome weather', 'GNOME Weather'],
         ['en', 'tt:stock_id', 'goog', 'alphabet inc.', 'Alphabet Inc.'],
         ['en', 'tt:stock_id', 'msft', 'microsoft corp.', 'Microsoft Corp.'],
         ]]);
}

async function loadStringValues(dbClient) {
    for (let type of ['tt:search_query', 'tt:long_free_text', 'tt:short_free_text', 'tt:person_first_name', 'tt:path_name']) {
        const filename = path.resolve(path.dirname(module.filename), './data/' + type + '.txt');
        const data = (await util.promisify(fs.readFile)(filename)).toString().trim().split('\n');

        const {id:typeId} = await db.selectOne(dbClient,
            `select id from string_types where language='en' and type_name=?`, [type]);
        await db.insertOne(dbClient,
            `insert into string_values(type_id,value,preprocessed,weight) values ?`,
            [data.map((v) => [typeId, v, v, 1.0])],
        );
    }
}

async function loadExamples(dbClient, bob) {
    const { id: schemaId } = await db.selectOne(dbClient, `select id from device_schema where kind = 'org.thingpedia.builtin.test'`);

    await exampleModel.createMany(dbClient, [
    // commandpedia
    {
        id: 999,
        schema_id: null,
        is_base: false,
        language: 'en',
        utterance: 'every day at 9:00 AM set my laptop background to pizza images',
        preprocessed: 'every day at TIME_0 set my laptop background to pizza images',
        target_json: '',
        target_code: '( attimer time = TIME_0 ) join ( @com.bing.image_search param:query:String = " pizza " ) => @org.thingpedia.builtin.thingengine.gnome.set_background on  param:picture_url:Entity(tt:picture) = param:picture_url:Entity(tt:picture)',
        type: 'commandpedia',
        owner: bob.id,
        click_count: 8,
        flags: '',
    },

    // thingpedia
    {
        id: 1000,
        schema_id: schemaId,
        is_base: true,
        language: 'en',
        utterance: 'eat some data',
        preprocessed: 'eat some data',
        target_json: '',
        target_code: 'let action x := @org.thingpedia.builtin.test.eat_data();',
        type: 'thingpedia',
        click_count: 0,
        flags: 'template'
    },
    {
        id: 1001,
        schema_id: schemaId,
        is_base: true,
        language: 'en',
        utterance: 'get ${p_size} of data',
        preprocessed: 'get ${p_size} of data',
        target_json: '',
        target_code: 'let query x := \\(p_size : Measure(byte)) -> @org.thingpedia.builtin.test.get_data(size=p_size);',
        type: 'thingpedia',
        click_count: 7,
        flags: 'template'
    },
    {
        id: 1002,
        schema_id: schemaId,
        is_base: true,
        language: 'en',
        utterance: 'keep eating data!',
        preprocessed: 'keep eating data !',
        target_json: '',
        target_code: 'monitor (@org.thingpedia.builtin.test.get_data()) => @org.thingpedia.builtin.test.eat_data();',
        type: 'thingpedia',
        click_count: 0,
        flags: 'template'
    },
    {
        id: 1003,
        schema_id: schemaId,
        is_base: true,
        language: 'en',
        utterance: 'keep eating data! (v2)',
        preprocessed: 'keep eating data ! -lrb- v2 -rrb-',
        target_json: '',
        target_code: 'program := monitor (@org.thingpedia.builtin.test.get_data()) => @org.thingpedia.builtin.test.eat_data();',
        type: 'thingpedia',
        click_count: 0,
        flags: 'template'
    },
    {
        id: 1004,
        schema_id: schemaId,
        is_base: true,
        language: 'en',
        utterance: 'more data eating...',
        preprocessed: 'more data eating ...',
        target_json: '',
        target_code: 'action () := @org.thingpedia.builtin.test.eat_data();',
        type: 'thingpedia',
        click_count: 0,
        flags: 'template'
    },
    {
        id: 1005,
        schema_id: schemaId,
        is_base: true,
        language: 'en',
        utterance: 'more data genning...',
        preprocessed: 'more data genning ...',
        target_json: '',
        target_code: 'let table _ := @org.thingpedia.builtin.test.get_data();',
        type: 'thingpedia',
        click_count: 0,
        flags: 'template'
    },

    {
        id: 1006,
        schema_id: null,
        is_base: false,
        language: 'en',
        utterance: 'dial USERNAME_0',
        preprocessed: 'dial USERNAME_0',
        target_json: '',
        target_code: 'now => @org.thingpedia.builtin.thingengine.phone.call param:number:Entity(tt:phone_number) = USERNAME_0',
        type: 'online',
        click_count: 0,
        flags: 'training'
    },
    {
        id: 1007,
        schema_id: null,
        is_base: false,
        language: 'en',
        utterance: 'make a call to USERNAME_0',
        preprocessed: 'make a call to USERNAME_0',
        target_json: '',
        target_code: 'now => @org.thingpedia.builtin.thingengine.phone.call param:number:Entity(tt:phone_number) = USERNAME_0',
        type: 'online',
        click_count: 0,
        flags: 'training'
    }

    ]);

    await exampleModel.like(dbClient, bob.id, 999);
}

async function main() {
    platform.init();

    await db.withTransaction(async (dbClient) => {
        const newOrg = await organization.create(dbClient, {
            name: 'Test Org',
            comment:  '',
            id_hash: makeRandom(8),
            developer_key: makeRandom(),
            is_admin: false
        });

        const bob = await user.register(dbClient, req, {
            username: 'bob',
            human_name: 'Bob Builder',
            password: '12345678',
            email: 'bob@localhost',
            email_verified: true,
            locale: 'en-US',
            timezone: 'America/Los_Angeles',
            developer_org: newOrg.id,
            profile_flags: user.ProfileFlags.VISIBLE_ORGANIZATION_PROFILE|user.ProfileFlags.SHOW_HUMAN_NAME|user.ProfileFlags.SHOW_PROFILE_PICTURE,

            // must be a TRUSTED_DEVELOPER to self-approve the new device
            // w/o hacks
            developer_status: user.DeveloperStatus.ORG_ADMIN,
            roles: user.Role.TRUSTED_DEVELOPER
        });
        await user.register(dbClient, req, {
            username: 'david',
            password: '12345678',
            email: 'david@localhost',
            email_verified: true,
            locale: 'en-US',
            timezone: 'America/Los_Angeles',
        });

        const [root] = await userModel.getByName(dbClient, 'root');
        await loadAllDevices(dbClient, bob, root);
        await loadEntityValues(dbClient);
        await loadStringValues(dbClient);
        await loadExamples(dbClient, bob);

        console.log(`export DEVELOPER_KEY="${newOrg.developer_key}" ROOT_DEVELOPER_KEY="${root.developer_key}"`);
    });

    await db.tearDown();
    TokenizerService.tearDown();
}
main();
