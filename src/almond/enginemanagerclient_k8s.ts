// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
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

import * as events from 'events';
import * as rpc from 'transparent-rpc';
import express from 'express';
import * as k8s from '@kubernetes/client-node';
import WebSocket from 'ws';

import JsonWebSocketAdapter from '../util/json_websocket';
import UserK8sApi from './user_k8s';
import * as proto from './protocol';
import type Engine from './engine';
import type { WebSocketApi, WebhookApi } from './platform';
import * as Tp from 'thingpedia';
import sleep from '../util/sleep';

type EngineProxy = rpc.Proxy<Engine> & {
    websocket : rpc.Proxy<WebSocketApi>;
    webhook : rpc.Proxy<WebhookApi>;
}

interface CachedEngine {
    engine : Promise<EngineProxy>;
    socket : rpc.Socket;
}

async function backendState(backendUrl : string, userId : number) : Promise<string> {
    const url = `${backendUrl}/engine-status?userid=${userId}`;
    const resp = await Tp.Helpers.Http.get(url);
    return JSON.parse(resp)["data"];
}

// poll every half second until engine is running or timedout. Error is thrown if timedout.
async function waitForEngine(userId : number, backendUrl : string, millis : number) {
    const waitms = 500;
    const deadline = Date.now() + millis;
    while (Date.now() <  deadline) {
        const state = await backendState(backendUrl, userId);
        if (state === UserK8sApi.Running)
            return;
        await sleep(waitms);
    }
    throw new Error(`wait for user ${userId} engine timedout`);
}


export default class EngineManagerClientK8s extends events.EventEmitter {
    private _cachedEngines : Map<number, CachedEngine>;
    private _expectClose : boolean;
    private userApi : UserK8sApi;


    constructor(namespace : string) {
        super();
        const kc = new k8s.KubeConfig();
        kc.loadFromDefault();
        this.userApi = new UserK8sApi(kc.makeApiClient(k8s.CustomObjectsApi), namespace);

        this.setMaxListeners(Infinity);
        this._cachedEngines = new Map;
        this._expectClose = false;
    }

    async getEngine(userId : number) : Promise<EngineProxy> {
        if (this._cachedEngines.has(userId)) {
             const cached = this._cachedEngines.get(userId)!;
             return cached.engine;
        }
        let user = await this.userApi.getUser(userId);
        if (user === null) {
            if (!await this.userApi.createUser(userId, UserK8sApi.Shared))
                throw new Error(`failed to create user ${userId}`);
        }
        if (user === null || !user.status || !user.status.backend)
            user = await this.userApi.waitForUser(userId, 10000);

        await waitForEngine(userId, user.status.backend, 10000);

        const parsedUrl = new URL(user.status.backend);
        const u = `ws://${parsedUrl.host}/engine`;
        const ws = new WebSocket(u);
        const socket = WebSocket.createWebSocketStream(ws);
        const jsonSocket = new JsonWebSocketAdapter(socket);
        let deleted = false;

        const rpcSocket = new rpc.Socket(jsonSocket);

        const onError = () => {
            if (this._expectClose)
                return;

            if (!deleted) {
                this._cachedEngines.delete(userId);
                this.emit('socket-closed', userId);
            }
            deleted = true;

        };

        rpcSocket.on('close', () => {
            onError();
        });

        jsonSocket.on('error', () => {
            onError();
        });

        const promise = new Promise<EngineProxy>((resolve, reject) => {
            // if we still can, catch the error early and fail the request
            rpcSocket.on('error', reject);
            const initError = (msg : proto.MasterToFrontend) => {
                if ('error' in msg) {
                    const err : Error & { code ?: string } = new Error(msg.error);
                    err.code = msg.code;
                    reject(err);
                }
            };
            jsonSocket.on('data', initError);

            const stub = {
                ready(engine : EngineProxy, websocket : rpc.Proxy<WebSocketApi>, webhook : rpc.Proxy<WebhookApi>) {
                    jsonSocket.removeListener('data', initError);
                    engine.websocket = websocket;
                    engine.webhook = webhook;
                    resolve(engine);
                },
                error(message : string) {
                    reject(new Error(message));
                },

                $rpcMethods: ['ready', 'error'] as const
            };
            const replyId = rpcSocket.addStub(stub);
            jsonSocket.write({ control: 'direct', target: userId, replyId: replyId });
        });
        this._cachedEngines.set(userId, {
            engine: promise,
            socket: rpcSocket
        });
        return promise;
    }

    async dispatchWebhook(userId : number, req : express.Request, res : express.Response) {
        const id = req.params.id;
        try {
            const engine = await this.getEngine(userId);
            const result = await engine.webhook.handleCallback(id, req.method as 'GET' | 'POST',
                req.query as Record<string, string | string[] | undefined>, req.headers, req.body);
            if (result) {
                if (result.contentType)
                    res.type(result.contentType);
                res.status(result.code).send(result.response);
            } else {
                res.status(200).json({ result: 'ok' });
            }
        } catch(err) {
            res.status(400).json({ error: err.message });
        }
    }

    start() {
        // not needed for k8s
    }

    stop() {
        this._expectClose = true;
        for (const engine of this._cachedEngines.values())
            engine.socket.end();
        this._cachedEngines.clear();
    }

    async killAllUsers() : Promise<boolean> {
        return this.userApi.deleteAllUsers();
    }

    async isRunning(userId : number) : Promise<boolean> {
        const user = await this.userApi.getUser(userId);
        if (user === null || !user.status || !user.status.backend)
            return false;
        const state = await backendState(user.status.backend, userId);
        return state === UserK8sApi.Running;
    }

    async getProcessId(userId : number) : Promise<number> {
        if (await this.isRunning(userId))
            return 1;
        return -1;
    }

    async startUser(userId : number) {
        await this.userApi.createUser(userId, UserK8sApi.Shared);
    }

    async killUser(userId : number) {
        await this.userApi.deleteUser(userId);
    }

    async deleteUser(userId : number) {
        await this.userApi.deleteUser(userId);
    }

    async clearCache(userId : number) {
        // not needed for k8s
    }

    async restartUser(userId : number) {
        await this.userApi.deleteUser(userId);
        await this.userApi.createUser(userId, UserK8sApi.Shared);
    }

    async restartUserWithoutCache(userId : number) {
        await this.restartUser(userId);
    }
}
