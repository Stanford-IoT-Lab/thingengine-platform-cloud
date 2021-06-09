// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

import * as db from '../util/db';

export interface Row {
    id : number;
    language : string;
    tag : string;
    owner : number;
    description : string;
    flags : string;
    public : boolean;
    version : number;
}
export type OptionalFields = 'language' | 'public' | 'version';

export async function getAll(client : db.Client) : Promise<Row[]> {
    return db.selectAll(client, "select * from template_files");
}

export async function getPublic(client : db.Client, owner : number|null) : Promise<Row[]> {
    return db.selectAll(client, "select * from template_files where public or owner = ?", [owner]);
}

export async function getByOwner(client : db.Client, owner : number) : Promise<Row[]> {
    return db.selectAll(client, "select * from template_files where owner = ?", [owner]);
}

export async function getForLanguage(client : db.Client, language : string) : Promise<Row[]> {
    return db.selectAll(client, "select * from template_files where language = ?", [language]);
}

export async function getByTag(client : db.Client, language : string, tag : string) : Promise<Row[]> {
    return db.selectOne(client, "select * from template_files where language = ? and tag = ?", [language, tag]);
}
export async function getByTagForUpdate(client : db.Client, language : string, tag : string) : Promise<Row[]> {
    return db.selectOne(client, "select * from template_files where language = ? and tag = ? for update", [language, tag]);
}

export async function create<T extends db.Optional<Row, OptionalFields>>(client : db.Client, tmpl : db.WithoutID<T>) : Promise<db.WithID<T>> {
    const id = await db.insertOne(client, "insert into template_files set ?", [tmpl]);
    tmpl.id = id;
    return tmpl as db.WithID<T>;
}
export async function update(client : db.Client, tmplId : number, tmpl : Partial<Row>) {
    await db.query(client, `update template_files set ? where id = ?`, [tmpl, tmplId]);
}