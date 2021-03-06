// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

import express from 'express';
import * as fs from 'fs';
import csvparse from 'csv-parse';
import * as util from 'util';
import * as Stream from 'stream';
import * as Genie from 'genie-toolkit';

import * as db from './db';
import * as user from './user';
import * as I18n from './i18n';
import { BadRequestError, ForbiddenError } from './errors';

import * as schemaModel from '../model/schema';
import * as entityModel from '../model/entity';
import * as stringModel from '../model/strings';

const NAME_REGEX = /^([A-Za-z_][A-Za-z0-9_.-]*):([A-Za-z_][A-Za-z0-9_]*)$/;

interface TokenizedRow {
    type_id : number;
    value : string;
    preprocessed : string;
    weight : number;
}

class StreamTokenizer extends Stream.Transform {
    private _preprocessed : boolean;
    private _typeId : number;
    private _tokenizer : Genie.I18n.BaseTokenizer;

    constructor(options : {
        language : string;
        preprocessed : boolean;
        typeId : number;
    }) {
        super({ objectMode: true });

        this._preprocessed = options.preprocessed;
        this._typeId = options.typeId;
        this._tokenizer = I18n.get(options.language).genie.getTokenizer();
    }

    _transform(row : string[], encoding : BufferEncoding, callback : (err ?: Error|null, out ?: TokenizedRow) => void) {
        if (row.length < 1 || !row[0]) {
            callback();
            return;
        }

        let value, preprocessed, weight;
        if (row.length === 1) {
            value = row[0];
            weight = 1.0;
        } else if (row.length === 2) {
            if (isFinite(+row[1])) {
                value = row[0];
                weight = parseFloat(row[1]);
            } else {
                value = row[0];
                preprocessed = row[1];
                weight = 1.0;
            }
        } else {
            value = row[0];
            preprocessed = row[1];
            weight = parseFloat(row[2]) || 1.0;
        }
        if (!(weight > 0.0))
            weight = 1.0;

        if (preprocessed === undefined && this._preprocessed)
            preprocessed = value;

        if (preprocessed !== undefined) {
            callback(null, {
                type_id: this._typeId,
                value, preprocessed, weight
            });
        } else {
            const result = this._tokenizer.tokenize(value);
            // ignore lines with uppercase (entity) tokens
            if (result.tokens.some((t) => /[A-Z]/.test(t))) {
                callback(null);
            } else {
                callback(null, {
                    type_id: this._typeId,
                    value,
                    preprocessed: result.tokens.join(' '),
                    weight
                });
            }
        }
    }

    _flush(callback : () => void) {
        process.nextTick(callback);
    }
}

export async function uploadEntities(req : express.Request) {
    const language = I18n.localeToLanguage(req.locale);
    const tokenizer = I18n.get(req.locale).genie.getTokenizer();

    try {
        await db.withTransaction(async (dbClient) => {
            const match = NAME_REGEX.exec(req.body.entity_id);
            if (match === null)
                throw new BadRequestError(req._("Invalid entity type ID."));

            const [, prefix, /*suffix*/] = match;

            if ((req.user!.roles & user.Role.THINGPEDIA_ADMIN) === 0) {
                let row;
                try {
                    row = await schemaModel.getByKind(dbClient, prefix);
                } catch(e) {
                    if (e.code !== 'ENOENT')
                        throw e;
                }
                if (!row || row.owner !== req.user!.developer_org)
                    throw new ForbiddenError(req._("The prefix of the entity ID must correspond to the ID of a Thingpedia device owned by your organization."));
            }

            const entity = {
                name: req.body.entity_name,
                id: req.body.entity_id,
                is_well_known: false,
                has_ner_support: !req.body.no_ner_support
            };

            try {
                const existing = await entityModel.get(dbClient, req.body.entity_id);
                if (entity.name === entity.id)
                    entity.name = existing.name;

                await entityModel.update(dbClient, existing.id, entity);
                await entityModel.deleteValues(dbClient, existing.id);
            } catch(e) {
                if (e.code !== 'ENOENT') throw e;
                await entityModel.create(dbClient, entity);
            }

            if (req.body.no_ner_support)
                return;

            if (!req.file)
                throw new BadRequestError(req._("You must upload a CSV file with the entity values."));

            const parser = csvparse({delimiter: ','});
            fs.createReadStream(req.file.path).pipe(parser);

            const transformer = new Stream.Transform({
                objectMode: true,

                transform(row, encoding, callback) {
                    if (row.length !== 2) {
                        callback();
                        return;
                    }

                    const value = row[0].trim();
                    const name = row[1];

                    const { tokens } = tokenizer.tokenize(name);
                    const canonical = tokens.join(' ');
                    callback(null, {
                        language,
                        entity_id: req.body.entity_id,
                        entity_value: value,
                        entity_canonical: canonical,
                        entity_name: name
                    });
                },

                flush(callback) {
                    process.nextTick(callback);
                }
            });

            const writer = entityModel.insertValueStream(dbClient);
            parser.pipe(transformer).pipe(writer);

            // we need to do a somewhat complex error handling dance to ensure
            // that we don't have any inflight requests by the time we terminate
            // the transaction, otherwise we might run SQL queries on the wrong
            // connection/transaction and that would be bad
            await new Promise<void>((resolve, reject) => {
                let error : Error|undefined;
                parser.on('error', (e) => {
                    error = new BadRequestError(e.message);
                    transformer.end();
                });
                transformer.on('error', (e) => {
                    error = e;
                    writer.end();
                });
                writer.on('error', reject);
                writer.on('finish', () => {
                    if (error)
                        reject(error);
                    else
                        resolve();
                });
            });
        });
    } finally {
        if (req.file)
            await util.promisify(fs.unlink)(req.file.path);
    }
}

export async function uploadStringDataset(req : express.Request) {
    const language = I18n.localeToLanguage(req.locale);

    try {
        await db.withTransaction(async (dbClient) => {
            const match = NAME_REGEX.exec(req.body.type_name);
            if (match === null)
                throw new BadRequestError(req._("Invalid string type ID."));
            if (['public-domain', 'free-permissive', 'free-copyleft', 'non-commercial', 'proprietary'].indexOf(req.body.license) < 0)
                throw new BadRequestError(req._("Invalid license."));

            const [, prefix, /*suffix*/] = match;

            if ((req.user!.roles & user.Role.THINGPEDIA_ADMIN) === 0) {
                let row;
                try {
                    row = await schemaModel.getByKind(dbClient, prefix);
                } catch(e) {
                    if (e.code !== 'ENOENT')
                        throw e;
                }
                if (!row || row.owner !== req.user!.developer_org)
                    throw new ForbiddenError(req._("The prefix of the dataset ID must correspond to the ID of a Thingpedia device owned by your organization."));
            }

            if (!req.file)
                throw new BadRequestError(req._("You must upload a TSV file with the string values."));

            let stringType;
            const string = {
                language: language,
                type_name: req.body.type_name,
                name: req.body.name,
                license: req.body.license,
                attribution: req.body.attribution || '',
            };

            try {
                stringType = await stringModel.getByTypeName(dbClient, req.body.type_name, language);
                if (string.license === 'public-domain')
                    string.license = stringType.license;
                string.attribution = string.attribution || stringType.attribution;
                if (string.name === string.type_name)
                    string.name = stringType.name;

                await stringModel.update(dbClient, stringType.id, string);
                await stringModel.deleteValues(dbClient, stringType.id);
            } catch(e) {
                stringType = await stringModel.create(dbClient, string);
            }

            const file = fs.createReadStream(req.file.path);
            file.setEncoding('utf8');
            const parser = file.pipe(csvparse({ delimiter: '\t', relax: true, relax_column_count: true }));
            const transformer = new StreamTokenizer({
                preprocessed: !!req.body.preprocessed,
                language,
                typeId: stringType.id,
            });
            const writer = stringModel.insertValueStream(dbClient);
            parser.pipe(transformer).pipe(writer);

            // we need to do a somewhat complex error handling dance to ensure
            // that we don't have any inflight requests by the time we terminate
            // the transaction, otherwise we might run SQL queries on the wrong
            // connection/transaction and that would be bad
            await new Promise<void>((resolve, reject) => {
                let error : Error|undefined;
                parser.on('error', (e) => {
                    error = new BadRequestError(e.message);
                    transformer.end();
                });
                transformer.on('error', (e) => {
                    error = e;
                    writer.end();
                });
                writer.on('error', reject);
                writer.on('finish', () => {
                    if (error)
                        reject(error);
                    else
                        resolve();
                });
            });
        });
    } finally {
        if (req.file)
            await util.promisify(fs.unlink)(req.file.path);
    }
}
