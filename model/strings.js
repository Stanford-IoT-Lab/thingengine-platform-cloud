// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingPedia
//
// Copyright 2018 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const stream = require('stream');
const db = require('../util/db');

module.exports = {
    async create(client, stringType) {
        const id = await db.insertOne(client, `insert into string_types set ?`, [stringType]);
        stringType.id = id;
        return stringType;
    },
    createMany(client, stringTypes) {
        return db.insertOne(client, `insert into string_types(language, type_name, name, license, attribution) values ?`,
            [stringTypes.map((st) => [st.language, st.type_name, st.name, st.license, st.attribution])]);
    },

    insertValueStream(client) {
        return new stream.Writable({
            objectMode: true,
            write(obj, encoding, callback) {
                client.query(`insert into string_values set ?`, [obj], callback);
            },
            writev(objs, callback) {
                client.query(`insert into string_values(type_id, value, preprocessed, weight) values ?`,
                [objs.map((o) => [o.chunk.type_id, o.chunk.value, o.chunk.preprocessed, o.chunk.weight])], callback);
            }
        });
    },

    get(client, id, language = 'en') {
        return db.selectOne(client, `select * from string_types where id = ? and language = ?`,
                            [id, language]);
    },
    getByTypeName(client, typeName, language = 'en') {
        return db.selectOne(client, `select * from string_types where type_name = ? and language = ?`,
                            [typeName, language]);
    },

    deleteByTypeName(client, typeName) {
        return db.query(client, `delete from string_types where type_name = ?`, [typeName]);
    },

    getAll(client, language = 'en') {
        return db.selectAll(client, `select * from string_types where language = ? order by type_name asc`,
            [language]);
    },

    getValues(client, typeName, language = 'en') {
        return db.selectAll(client, `select preprocessed, weight from string_values, string_types
            where type_id = id and type_name = ? and language = ?`, [typeName, language]);
    },

    streamValues(client, typeName, language = 'en') {
        return client.query(`select value, preprocessed, weight from string_values, string_types
            where type_id = id and type_name = ? and language = ?`, [typeName, language]);
    },

    findNonExisting(client, ids) {
        if (ids.length === 0)
            return Promise.resolve([]);
        return db.selectAll(client, "select type_name from string_types where language='en' and type_name in (?)", [ids]).then((rows) => {
            if (rows.length === ids.length)
                return [];
            let existing = new Set(rows.map((r) => r.type_name));
            let missing = [];
            for (let id of ids) {
                if (!existing.has(id))
                    missing.push(id);
            }
            return missing;
        });
    }
};
