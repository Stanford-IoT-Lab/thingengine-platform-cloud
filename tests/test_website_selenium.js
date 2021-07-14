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

// load thingpedia to initialize the polyfill
import 'thingpedia';
process.on('unhandledRejection', (up) => { throw up; });
import '../src/util/config_init';

import assert from 'assert';
import * as Tp from 'thingpedia';

import * as WD from 'selenium-webdriver';
import * as chrome from 'selenium-webdriver/chrome';
import * as firefox from 'selenium-webdriver/firefox';

import * as Config from '../src/config';

const BASE_URL = process.env.THINGENGINE_URL || Config.SERVER_ORIGIN;

async function withSelenium(test) {
    const builder = new WD.Builder()
        .forBrowser('firefox');

    // on Travis CI we run headless; setting up Xvfb is
    // just annoying and not very useful
    if (process.env.TRAVIS) {
        builder
        .setFirefoxOptions(
            new firefox.Options().headless()
        )
        .setChromeOptions(
            new chrome.Options().headless()
        );
    }

    const driver = builder.build();
    try {
        await test(driver);
    } finally {
        driver.quit();
    }
}

const _checkedImages = new Set;

/**
 * Check that all images have URLs that return a valid image
 * (valid HTTP status and valid content-type).
 */
async function checkAllImages(driver) {
    const currentUrl = await driver.getCurrentUrl();
    const images = await driver.findElements(WD.By.css('img'));

    await Promise.all(images.map(async (img) => {
        const src = await img.getAttribute('src');

        // small optimization: we only check an image once
        // (we don't have dynamic images)
        // (we still need to use selenium to check images rather than
        // a linkchecker-style approach to make sure we catch JS-added
        // images)
        if (_checkedImages.has(src))
            return;
        _checkedImages.add(src);

        // this is not exactly what the browser does
        console.log('checking ' + src);
        const res = await Tp.Helpers.Http.getStream(src, { extraHeaders: {
            Referrer: currentUrl
        }});
        assert(res.headers['content-type'].startsWith('image/'),
               `expected image/* content type for image, found ${res['content-type']}`);
        res.resume();
    }));
}

async function fillFormField(driver, id, ...value) {
    const entry = await driver.findElement(WD.By.id(id));
    await entry.sendKeys(...value);
}

async function login(driver, username, password) {
    await driver.get(BASE_URL + '/');

    const loginLink = await driver.wait(
        WD.until.elementLocated(WD.By.linkText('Log In')),
        30000);
    await checkAllImages(driver);
    await loginLink.click();

    const submit = await driver.wait(
        WD.until.elementLocated(WD.By.css('button.btn.btn-primary[type=submit]')),
        30000);
    await checkAllImages(driver);

    await fillFormField(driver, 'username', username);
    await fillFormField(driver, 'password', password);

    await submit.click();
}

async function testHomepage(driver) {
    await driver.get(BASE_URL + '/');

    const title = await driver.wait(
        WD.until.elementLocated(WD.By.id('almond-title')),
        30000);
    await checkAllImages(driver);

    assert.strictEqual(await title.getText(), 'Genie');

    const subtitle = await driver.findElement(WD.By.id('almond-subtitle'));
    if (Config.ABOUT_OVERRIDE['index'] === 'stanford/about_index.pug')
        assert.strictEqual(await subtitle.getText(), 'The Open, Privacy-Preserving Virtual Assistant');
    else
        assert.strictEqual(await subtitle.getText(), 'The Open Virtual Assistant');

    /*if (Config.WITH_THINGPEDIA === 'embedded') {
        await driver.wait(WD.until.elementLocated(WD.By.css('#command-container .command-utterance')),
            45000);

        const commands = await driver.findElements(WD.By.css('#command-container .command-utterance'));
        assert.strictEqual(commands.length, 18);

        assert.strictEqual(await commands[0].getText(), 'every day at 9:00 AM set my laptop background to pizza images');
    }*/
}

// there is some randomness in what message we pick
const WELCOME_MESSAGES = [
    `Hi, what can I do for you?`,
    `Hi, how can I help you?`,
    `Hello, what can I do for you?`,
    `Hello, how can I help you?`,
    `Hi! What can I do for you?`,
    `Hi! How can I help you?`,
    `Hello! What can I do for you?`,
    `Hello! How can I help you?`,
];

const HAS_DATA_COLLECTION_CONFIRMATION = false;
async function skipDataCollectionConfirmation(driver) {
    await driver.get(BASE_URL + '/me');
    await driver.wait(
        WD.until.elementLocated(WD.By.css('.message')),
        30000);
    await checkAllImages(driver);

    // wait some extra time for the almond thread to respond
    await driver.sleep(5000);

    let messages = await driver.findElements(WD.By.css('.message'));
    // TODO: first time welcome message
    assert(WELCOME_MESSAGES.includes(await messages[0].getText()));

    if (HAS_DATA_COLLECTION_CONFIRMATION) {
        // ignore the blurb about data collection, skip to the yes/no question
        // at the end
        await driver.wait(
            WD.until.elementLocated(WD.By.css('.message.message-yesno.btn')),
            30000);
        const yesNo = await driver.findElements(WD.By.css('.message.message-yesno.btn'));
        assert.strictEqual(yesNo.length, 2);
        assert.strictEqual(await yesNo[0].getText(), 'Yes');
        assert.strictEqual(await yesNo[1].getText(), 'No');
        // click no
        await yesNo[1].click();
    }
}

async function testMyConversation(driver) {
    await login(driver, 'david', '12345678');

    await skipDataCollectionConfirmation(driver);

    // refresh the page
    await driver.get(BASE_URL + '/me');

    const inputEntry = await driver.wait(
        WD.until.elementLocated(WD.By.id('input')),
        30000);
    await checkAllImages(driver);

    // wait some extra time for the almond thread to respond
    await driver.sleep(5000);

    let messages = await driver.findElements(WD.By.css('.message'));
    assert.strictEqual(messages.length, 1);
    assert(WELCOME_MESSAGES.includes(await messages[0].getText()));

    // todo: use a better test
    await inputEntry.sendKeys('no', WD.Key.ENTER);

    const ourInput = await driver.wait(
        WD.until.elementLocated(WD.By.css('.message.from-user:nth-child(2)')),
        10000);
    assert.strictEqual(await ourInput.getText(), 'no');

    const response = await driver.wait(
        WD.until.elementLocated(WD.By.css('.from-almond:nth-child(3) .message')),
        60000);
    assert.strictEqual(await response.getText(), 'Sorry, I did not understand that.');
}

async function assertHasClass(element, className) {
    const classes = (await element.getAttribute('class')).split(' ');
    assert(classes.indexOf(className) >= 0,
        `expected ${element} to have class ${className}, found only [${classes}]`);
}
async function assertDoesNotHaveClass(element, className) {
    const classes = (await element.getAttribute('class')).split(' ');
    assert(classes.indexOf(className) < 0,
        `expected ${element} not to have class ${className}`);
}
async function assertElementValue(driver, cssSelector, expectedText) {
    const element = await driver.findElement(WD.By.css(cssSelector));
    assert.strictEqual(await element.getAttribute('value'), expectedText);
}

async function testRegister(driver) {
    await driver.get(BASE_URL + '/');

    if (Config.EXTRA_ABOUT_PAGES.find((x) => x.url === 'get-almond')) {
        // in Stanford mode, we click on Get Almond, and from there to Create An Account
        const getAlmond = await driver.wait(
            WD.until.elementLocated(WD.By.linkText('Get Genie')),
            30000);
        await checkAllImages(driver);

        await getAlmond.click();

        const createAccount = await driver.wait(
            WD.until.elementLocated(WD.By.linkText('Create An Account')),
            30000);
        await checkAllImages(driver);

        await createAccount.click();
    } else {
        // in product mode, we click on Log In, and from there to Sign Up Now!

        const logIn = await driver.wait(
            WD.until.elementLocated(WD.By.linkText('Log In')),
            30000);
        await checkAllImages(driver);

        await logIn.click();

        const signUpNow = await driver.wait(
            WD.until.elementLocated(WD.By.linkText('Sign up now!')),
            30000);
        await checkAllImages(driver);

        await signUpNow.click();
    }

    // now we're in the registration page
    const submit = await driver.wait(
        WD.until.elementLocated(WD.By.css('button.btn.btn-primary[type=submit]')),
        30000);

    await fillFormField(driver, 'username', 'alice');
    await fillFormField(driver, 'email', 'alice@localhost');
    await fillFormField(driver, 'password', '1234');

    // the help text should be red by now
    const min8CharText = await driver.wait(
        WD.until.elementLocated(WD.By.css('.has-error > #password + .help-block')),
        30000);
    // and we cannot submit
    await assertHasClass(submit, 'disabled');

    // fill some more text
    await fillFormField(driver, 'password', '5678');
    // wait 1s...
    await driver.sleep(1000);

    // and now the help text should not be red
    await assertDoesNotHaveClass(min8CharText, 'with-errors');
    // we still cannot submit tho
    await assertHasClass(submit, 'disabled');

    // fill the confirmation now
    await fillFormField(driver, 'confirm-password', '12345677');

    // uh oh! we made a typo!
    const confirmPasswordText = await driver.wait(
        WD.until.elementLocated(WD.By.css('.has-error > #confirm-password + .help-block')),
        30000);

    assert.strictEqual(await confirmPasswordText.getText(),
        `The password and the confirmation must match`);

    // change and go back
    await fillFormField(driver, 'confirm-password', WD.Key.BACK_SPACE, '8');

    // no more error
    await driver.wait(WD.until.elementIsNotVisible(confirmPasswordText), 30000);

    // click the checkbox for the terms
    await (await driver.findElement(WD.By.css('input[type=checkbox][name=agree_terms]'))).click();

    // and we can submit
    await assertDoesNotHaveClass(submit, 'disabled');

    // so let's do it!
    await submit.click();

    // we're logged in, so we get a nice link to the Settings page
    const settingsLink = await driver.wait(
        WD.until.elementLocated(WD.By.linkText('Settings')),
        120000);

    // let's click it...
    await settingsLink.click();

    // wait until enough of the form is loaded...
    await driver.wait(
        WD.until.elementLocated(WD.By.css('button.btn.btn-primary[type=submit]')),
        30000);

    // check it is us...
    await assertElementValue(driver, '#username', 'alice');
    await assertElementValue(driver, '#email', 'alice@localhost');
}

async function main() {
    await withSelenium(testHomepage);
    await withSelenium(testMyConversation);
    await withSelenium(testRegister);
}
main();
