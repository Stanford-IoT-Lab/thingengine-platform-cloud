#!/usr/bin/env node
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
"use strict";

const fs = require('fs');
const util = require('util');
const path = require('path');
const lunr = require('lunr');
require("lunr-languages/lunr.stemmer.support")(lunr);

const markdown = require('markdown-it');

function slugify(s) {
    return encodeURIComponent(String(s).trim().toLowerCase().replace(/\s+/g, '-'));
}

async function main() {
    const builder = new lunr.Builder();  
    builder.field('title', { boost: 2 });
    builder.field('page_title');
    builder.field('content');
    builder.ref('url');
    builder.metadataWhitelist.push('position');
    
    const documents = {};
    for (let file of await util.promisify(fs.readdir)('./doc')) {
        if (!file.endsWith('.md'))
            continue;

        const md = new markdown();
        md.use(require('markdown-it-anchor'));
        md.use(require('markdown-it-highlightjs'));
        md.use(require('markdown-it-container-pandoc'));
        md.use(require('markdown-it-table-of-contents'), { includeLevel: [2,3] });

        const content = (await util.promisify(fs.readFile)(path.resolve('./doc', file))).toString();

        const current_uri = '/doc/' + file;
        let page_title = '';
        let current_heading = '';
        let current_heading_slug = '';
        let document = [];
        let prev_block = null;
        const addDoc = () => {
            const url = current_uri + current_heading_slug;
            const doc = {
                url,
                page_title,
                title: current_heading,
                content: document.join(' ')
            };
            documents[url] = doc;
            builder.add(doc);
        };
        
        for (let block of md.parse(content, {})) {
            if (block.type === 'inline') {
                if (prev_block && prev_block.type === 'heading_open') {
                    if (document.length > 0)
                        addDoc();
                    current_heading_slug = '#' + slugify(block.content);
                    current_heading = block.content;
                    if (prev_block.markup === '#')
                        page_title = block.content;
                    document = [];
                }

                for (let child of block.children) {
                    if (child.type === 'text')
                        document.push(child.content);
                }
            }
            prev_block = block;
        }
        if (document.length > 0)
            addDoc();
    }
    
    const index = builder.build();
    const file = {
        index,
        documents
    };
    
    await util.promisify(fs.writeFile)('./doc/fts.json.tmp', JSON.stringify(file));
    await util.promisify(fs.rename)('./doc/fts.json.tmp', './doc/fts.json');
}
main();
