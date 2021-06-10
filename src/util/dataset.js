// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2018-2020 The Board of Trustees of the Leland Stanford Junior University
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

import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';
import { stringEscape } from './escaping';
import { splitParams } from './tokenize';

import * as db from './db';
import * as exampleModel from '../model/example';
import * as deviceModel from '../model/device';
import { InternalError } from './errors';
import { uniform } from './random';

export function exampleToCode(example) {
    const clone = example.clone();
    clone.id = -1;
    clone.utterances = [];
    clone.preprocessed = [];
    clone.annotations = {};

    let code = clone.prettyprint();
    // porkaround a bug in ThingTalk
    code = code.replace(/[ \r\n\t\v]*#_\[utterances=\[\]\][ \r\n\t\v]*/g, '').trim();
    return code;
}

const platformDevices = {
    'org.thingpedia.builtin.thingengine.gnome': 'gnome',
    'org.thingpedia.builtin.thingengine.phone': 'android',
};

export function getCheatsheet(language, options) {
    return loadThingpedia(language, options).then(([devices, examples]) => {
        const deviceMap = new Map;
        devices.forEach((d, i) => {
            d.examples = [];

            if (options.forPlatform === 'server') {
                if (d.factory && d.factory !== 'null' && JSON.parse(d.factory).type === 'oauth2')
                    return;
            }
            if (options.forPlatform && platformDevices[d.primary_kind]
                && options.forPlatform !== platformDevices[d.primary_kind])
                return;
            deviceMap.set(d.primary_kind, i);
        });


        const dupes = new Set;
        examples.forEach((ex) => {
            if (dupes.has(ex.target_code) || !ex.target_code)
                return;
            dupes.add(ex.target_code);
            let kind = ex.kind;
            if (!deviceMap.has(kind)) {
                // ignore what we don't recognize
                console.log('Unrecognized kind ' + kind);
            } else {
                devices[deviceMap.get(kind)].examples.push(ex);
            }
        });


        for (let device of devices)
            device.examples = sortAndChunkExamples(device.examples);

        return devices;
    });
}


async function loadCheatsheetFromFile(language, thingpedia, dataset, random = true, options = {}) {
    const tpClient = new Tp.FileClient({
        locale: language,
        thingpedia, dataset
    });
    const deviceNames = await tpClient.getAllDeviceNames(null);
    const devices = [];
    const devices_rev = {};
    for (let dev of deviceNames) {
        devices.push({
            primary_kind: dev.kind,
            name: dev.kind_canonical
        });
        devices_rev[dev.kind] = true;
    }

    let parsedExamples = ThingTalk.Syntax.parse(await tpClient.getAllExamples()).datasets[0].examples;
    const examples = parsedExamples.map((e) => {
        let kind;
        for (let [, invocation] of e.iteratePrimitives())
            kind = invocation.selector.kind;
        if (kind in devices_rev) {
            let utterance = random ? uniform(e.utterances, options.rng) : e.utterances[0];
            return {
                kind: kind,
                utterance: utterance,
                target_code: exampleToCode(e)
            };
        } else {
            return null;
        }
    }).filter((e) => !!e);
    return [devices, examples];
}

function loadThingpedia(language, { forPlatform, thingpedia, dataset, rng = Math.random }) {
    if (thingpedia && dataset) {
        return loadCheatsheetFromFile(language, thingpedia, dataset, true, { rng });
    } else {
        return db.withClient((dbClient) => {
            return Promise.all([
                forPlatform !== undefined ? deviceModel.getAllApprovedWithCode(dbClient, null) : deviceModel.getAllApproved(dbClient, null),
                exampleModel.getCheatsheet(dbClient, language)
            ]);
        });
    }
}

function rowsToExamples(rows, { editMode = false, skipId = false }) {
    // coalesce by target code

    // note: this code is designed to be fast, and avoid parsing the examples in the common
    // case of up-to-date thingpedia

    let uniqueCode = new Map;
    for (let row of rows) {
        let targetCode = row.target_code || row.program;
        if (!targetCode)
            throw new InternalError('E_DATASET_CORRUPT', `Invalid example ${row.id}, missing program`);

        // convert each example from ThingTalk 1 to ThingTalk 2 if necessary
        // quick and dirty check to identify the syntax version
        if (targetCode.indexOf(':=') >= 0) {
            const parsed = ThingTalk.Syntax.parse(`dataset @foo { ${targetCode} }`, ThingTalk.Syntax.SyntaxType.Legacy);
            targetCode = parsed.datasets[0].examples[0].prettyprint();

            // porkaround a bug in ThingTalk
            targetCode = targetCode.replace(/#_\[utterances=\[\]\]/g, '').trim();
        }

        // remove trailing semicolon
        targetCode = targetCode.replace(/[ \r\n\t\v]*;[ \r\n\t\v]*$/, '');

        if (uniqueCode.has(targetCode)) {
            const ex = uniqueCode.get(targetCode);
            ex.utterances.push(row.utterance);
            ex.preprocessed.push(row.preprocessed);
            if (row.name && !ex.name)
                ex.name = row.name;
        } else {
            uniqueCode.set(targetCode, {
                id: row.id,
                utterances: [row.utterance],
                preprocessed: [row.preprocessed],
                click_count: row.click_count,
                like_count: row.like_count,
                name: row.name,
                kind: row.kind
            });
        }
    }


    let buffer = [];
    for (let [targetCode, ex] of uniqueCode.entries()) {
        if (editMode) {
            if (!skipId && ex.id !== undefined) {
                buffer.push(`  ${targetCode}
  #_[utterances=[${ex.utterances.map(stringEscape).join(',\n' + ' '.repeat(19))}]]
  #[id=${ex.id}]
  #[name=${stringEscape(ex.name || '')}];

`);
            } else {
                buffer.push(`  ${targetCode}
  #_[utterances=[${ex.utterances.map(stringEscape).join(',\n' + ' '.repeat(19))}]]
  #[name=${stringEscape(ex.name || '')}];

`);
            }
        } else {
            buffer.push(`  ${targetCode}
  #_[utterances=[${ex.utterances.map(stringEscape)}]]
  #_[preprocessed=[${ex.preprocessed.map(stringEscape)}]]
  #[id=${ex.id}] #[click_count=${ex.click_count}] #[like_count=${ex.like_count}]
  #[name=${stringEscape((ex.kind ? ex.kind + '.' : '') + (ex.name || ''))}];
`);
        }
    }

    return buffer.join('');
}

export function sortAndChunkExamples(rows) {
    let functionTypes = new Map;

    let trigger_ex = [], query_ex = [], action_ex = [], other_ex = [];
    for (let ex of rows) {
        ex.target_code = ex.target_code.replace(/^\s*let\s+table/, 'query')
            .replace(/^\s*let\s+(stream|query|action)/, '$1');

        const match = /^\s*(stream|query|action|program)/.exec(ex.target_code);
        if (match === null)
            ex.type = 'program';
        else
            ex.type = match[1];

        if (ex.utterance.startsWith(','))
            ex.utterance = ex.utterance.substring(1);
        ex.utterance_chunks = splitParams(ex.utterance.trim());

        const functions = [];
        for (const [fn,] of ex.target_code.matchAll(/@\s*[a-z0-9_-]+(?:\.[a-z0-9_-]+)*/g))
            functions.push(fn.substring(1));

        if (ex.type === 'action') {
            // all queries except the last one
            for (let i = 0; i < functions.length-1; i++)
                functionTypes.set(functions[i], 'query');
            functionTypes.set(functions[functions.length-1], 'action');
        } else if (ex.type !== 'program') {
            // all queries
            for (let i = 0; i < functions.length; i++)
                functionTypes.set(functions[i], 'query');
        }

        switch (match[1]) {
        case 'stream':
            trigger_ex.push(ex);
            break;
        case 'query':
            query_ex.push(ex);
            break;
        case 'action':
            action_ex.push(ex);
            break;
        default:
            other_ex.push(ex);
            break;
        }
    }

    for (const ex of other_ex) {
        // let's find what function this one is...
        const functions = [];
        for (const [fn,] of ex.target_code.matchAll(/@\s*[a-z0-9_-]+(?:\.[a-z0-9_-]+)*/g))
            functions.push(fn.substring(1));

        if (functions.length === 1 && functions[0] === 'org.thingpedia.builtin.thingengine.builtin.faq_reply')
            ex.type = ex.utterance.endsWith('?') ? 'query' : 'action';
        else if (functions.every((f) => functionTypes.get(f) === 'query'))
            ex.type = 'query';
        else
            ex.type = 'action';

        if (ex.type === 'action')
            action_ex.push(ex);
        else
            query_ex.push(ex);
        continue;
    }

    return [].concat(trigger_ex, query_ex, action_ex);
}

export async function examplesToDataset(name, language, rows, options = {}) {
    const code = `dataset @${name}
#[language="${language}"] {
${rowsToExamples(rows, options)}}`;

    // convert code to thingtalk 1 if necessary
    if (options.needs_compatibility) {
        const AdminThingpediaClient = (await import('./admin-thingpedia-client')).default;
        const tpClient = new AdminThingpediaClient(language, options.dbClient || null);
        const schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);

        const parsed = ThingTalk.Syntax.parse(code);
        await parsed.typecheck(schemas, false);
        return ThingTalk.Syntax.serialize(parsed, ThingTalk.Syntax.SyntaxType.Normal, undefined, {
            compatibility: options.thingtalk_version
        });
    } else {
        return code;
    }
}
