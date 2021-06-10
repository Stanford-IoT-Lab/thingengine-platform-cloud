sources = \
	src/*.js \
	src/*.ts \
	src/*/*.js \
	src/*/*.ts \
	src/*/*/*.js \
	src/*/*/*.ts \
	src/*/*/*/*.js \
	src/*/*/*/*.ts

all: install prepare

prepare: dist prepare-bundles prepare-mo

dist: $(wildcard $(sources)) tsconfig.json
	tsc --build tsconfig.json
	chmod +x dist/main.js
	touch dist

public/javascripts/%-bundle.js : browser/%.js browser/deps/* package-lock.json
	browserify -o $@ $<

bundles := \
	admin-nl-training \
	commandpedia \
	thingpedia-device-create \
	thingpedia-device-translate \
	thingpedia-portal \
	blog-editor \
	dev-console-nlp-models \
	conversation

prepare-bundles: $(foreach b,$(bundles),public/javascripts/$(b)-bundle.js)

%.mo: %.po
	msgfmt $< -o $@

languages := it zh_CN es
prepare-mo: $(foreach l,$(languages),po/$(l).mo)

install:
	make -C sandbox all || echo WARNING: failed to compile the sandbox

.PHONY: install prepare prepare-bundles prepare-mo
