/*
 * Liquid pattern engine for patternlab-node - v2.X.X - 2017
 *
 * Cameron Roe
 * Licensed under the MIT license.
 *
 *
 */

'use strict';

const fs = require('fs-extra');
const path = require('path');
const isDirectory = source => fs.lstatSync(source).isDirectory();
const getDirectories = source =>
  fs
    .readdirSync(source)
    .map(name => path.join(source, name))
    .filter(isDirectory);
const renderSass = require('sass').render;

var utils = require('./util_liquid');
var Liquid = require('liquidjs').Liquid;

let globalDataFilePath;
let globalData;
let engine = new Liquid({
  dynamicPartials: true,
  extname: '.liquid'
});

// This holds the config from from core. The core has to call
// usePatternLabConfig() at load time for this to be populated.
let patternLabConfig = {};

module.exports = {
  engine: engine,
  engineName: 'liquid',
  engineFileExtension: ['.liquid', '.html'],
  isAsync: true,

  // // partial expansion is only necessary for Mustache templates that have
  // // style modifiers or pattern parameters (I think)
  // expandPartials: true,

  // regexes, stored here so they're only compiled once
  findPartialsRE: utils.partialsRE,
  findPartialsWithStyleModifiersRE: utils.partialsWithStyleModifiersRE,
  findPartialsWithPatternParametersRE: utils.partialsWithPatternParametersRE,
  findListItemsRE: utils.listItemsRE,
  findPartialRE: utils.partialRE,

  // render it
  renderPattern: function renderPattern(pattern, data, partials) {
    globalData = JSON.parse(fs.readFileSync(globalDataFilePath));

    return engine
      .parseAndRender(pattern.template, data, {
        globals: {
          ...globalData,
          is_patternlab: true
        }
      })
      .then(function(html) {
        return html;
      })
      .catch(function(ex) {
        console.log(40, ex);
      });
  },

  /**
   * Find regex matches within both pattern strings and pattern objects.
   *
   * @param {string|object} pattern Either a string or a pattern object.
   * @param {object} regex A JavaScript RegExp object.
   * @returns {array|null} An array if a match is found, null if not.
   */
  patternMatcher: function patternMatcher(pattern, regex) {
    var matches;
    if (typeof pattern === 'string') {
      matches = pattern.match(regex);
    } else if (
      typeof pattern === 'object' &&
      typeof pattern.template === 'string'
    ) {
      matches = pattern.template.match(regex);
    }
    return matches;
  },

  // find and return any {{> template-name }} within pattern
  findPartials: function findPartials(pattern) {
    var matches = this.patternMatcher(pattern, this.findPartialsRE);
    return matches;
  },
  findPartialsWithStyleModifiers: function(pattern) {
    var matches = this.patternMatcher(
      pattern,
      this.findPartialsWithStyleModifiersRE
    );
    return matches;
  },

  // returns any patterns that match {{> value(foo:"bar") }} or {{>
  // value:mod(foo:"bar") }} within the pattern
  findPartialsWithPatternParameters: function(pattern) {
    var matches = this.patternMatcher(
      pattern,
      this.findPartialsWithPatternParametersRE
    );
    return matches;
  },
  findListItems: function(pattern) {
    var matches = this.patternMatcher(pattern, this.findListItemsRE);
    return matches;
  },

  // given a pattern, and a partial string, tease out the "pattern key" and
  // return it.
  findPartial_new: function(partialString) {
    var partial = partialString.replace(this.findPartialRE, '$1');
    return partial;
  },

  // GTP: the old implementation works better. We might not need
  // this.findPartialRE anymore if it works in all cases!
  findPartial: function(partialString) {
    //strip out the template cruft
    var foundPatternPartial = partialString
      .replace('{{> ', '')
      .replace(' }}', '')
      .replace('{{>', '')
      .replace('}}', '');

    // remove any potential pattern parameters. this and the above are rather brutish but I didn't want to do a regex at the time
    if (foundPatternPartial.indexOf('(') > 0) {
      foundPatternPartial = foundPatternPartial.substring(
        0,
        foundPatternPartial.indexOf('(')
      );
    }

    //remove any potential stylemodifiers.
    foundPatternPartial = foundPatternPartial.split(':')[0];

    return foundPatternPartial;
  },

  /**
   * Accept a Pattern Lab config object from the core and put it in
   * this module's closure scope so we can configure engine behavior.
   *
   * @param {object} config - the global config object from core
   */
  usePatternLabConfig: function(config) {
    patternLabConfig = config;
    let patternsPath = patternLabConfig.paths.source.patterns;

    globalDataFilePath = path.join(process.cwd(), patternLabConfig.paths.source.data, 'data.json');
    globalData = JSON.parse(fs.readFileSync(globalDataFilePath));

    if (patternsPath.slice(-1) === '/') {
      patternsPath = patternsPath.slice(0, -1);
    }

    const rootDirectories = getDirectories(patternsPath);
    const allPaths = rootDirectories.reduce((allDirs, dir) => {
      return [
        ...allDirs,
        ...getDirectories(dir)
      ];
    }, rootDirectories);

    engine = new Liquid({
      dynamicPartials: true,
      root: allPaths,
      extname: '.liquid',
      globals: {
        ...globalData,
        is_patternlab: true
      }
    });

    engine.registerTag('form', {
      parse: function (tagToken, remainTokens) {
        const { args } = tagToken;

        this.formClass = null;
        if (args) {
          const formClassRegex = args.match(/(class: ?('|"))(.+)(('|"))/);
          this.formClass = formClassRegex && formClassRegex[3];

          const dataAttributesRegex = [...args.matchAll(/(data-(.+)): (('|")?(.+)?('|")?)/g)];
          this.dataAttributes = dataAttributesRegex && dataAttributesRegex.length > 0 ? dataAttributesRegex.map(item => ({
            attribute: item[1],
            value: item[5].replace(/'?,$/, ''),
            variable: item[4] === undefined
          })) : [];
        }

        this.tokens = [];

        const stream = this.liquid.parser.parseStream(remainTokens);
        stream
          .on('token', (token) => {
            if (token.name === 'endform') {
              stream.stop();
            } else {
              this.tokens.push(token);
            }
          })
          .on('end', () => {
            throw new Error(`tag ${tagToken.getText()} not closed`)
          });

        stream.start();
      },
      render: async function (ctx, hash) {
        const content = this.tokens.map(token => token.getText()).join('');
        const renderedContent = await this.liquid.parseAndRender(content, ctx.getAll(), ctx.opts);
        const formAttributes = this.dataAttributes.length > 0 ? this.dataAttributes.reduce((attributes, item) => `${attributes} ${item.attribute}${item.value ? `="${item.variable === true ? `{{ ${item.value} }}` : item.value}"` : ''}`, '') : '';

        return await this.liquid.parseAndRender(`<form class="${this.formClass || ''}"${formAttributes ? ` ${formAttributes}` : ''}>${renderedContent}</form>`, ctx.getAll(), ctx.opts);
      }
    });

    engine.registerTag('paginate', {
      parse: function (tagToken, remainTokens) {
        this.tokens = [];

        const stream = this.liquid.parser.parseStream(remainTokens);
        stream
          .on('token', (token) => {
            if (token.name === 'endpaginate') {
              stream.stop();
            } else {
              this.tokens.push(token);
            }
          })
          .on('end', () => {
            throw new Error(`tag ${tagToken.getText()} not closed`)
          });

        stream.start();
      },
      render: async function (ctx, hash) {
        const content = this.tokens.map(token => token.getText()).join('');
        const renderedContent = await this.liquid.parseAndRender(content, ctx.getAll(), ctx.opts);
        return renderedContent;
      }
    });

    engine.registerTag('schema', {
      parse: function (tagToken, remainTokens) {
        this.tokens = [];

        const stream = this.liquid.parser.parseStream(remainTokens);
        stream
          .on('token', (token) => {
            if (token.name === 'endschema') {
              stream.stop();
            } else {
              this.tokens.push(token);
            }
          })
          .on('end', () => {
            throw new Error(`tag ${tagToken.getText()} not closed`)
          });

        stream.start();
      },
      render: function (scope, hash) {
        const content = this.tokens.map(token => token.getText()).join('');
        return `<script id="schema" type="application/json">${content}</script>`;
      }
    });

    engine.registerTag('section', {
      parse: function (token) {
        const quoted = /^'[^']*'|"[^"]*"$/;

        this.namestr = token.args;

        if (quoted.exec(this.namestr)) {
          this.template = this.namestr.slice(1, -1);
        }

        this.sectionData = {};
        let sectionDataFilePath;

        for (const directoryPath of allPaths) {
          const filePath = path.join(process.cwd(), directoryPath, `${this.template}.json`);

          if (fs.existsSync(filePath)) {
            sectionDataFilePath = filePath;
            break;
          }
        }

        if (sectionDataFilePath) {
          this.sectionData = JSON.parse(fs.readFileSync(sectionDataFilePath));

          if (this.sectionData && this.sectionData.section) {
            this.sectionData.section = {
              ...this.sectionData.section,
              id: Math.random().toString(36).substr(2, 9),
              blocks: this.sectionData.section.blocks ? this.sectionData.section.blocks.map(block => ({
                ...block,
                id: Math.random().toString(36).substr(2, 9)
              })) : []
            };
          }
        }
      },
      render: async function (ctx, hash) {
        const output = await this.liquid.renderFile(`${this.template}.${patternLabConfig.patternExtension}`, this.sectionData);
        const schemaRegex = output.match(/<script id="schema" type="application\/json">(.*)<\/script>/s);
        const schema = schemaRegex && schemaRegex[1] ? JSON.parse(schemaRegex[1]) : null;

        const formattedOutput = `<div id="shopify-section-${schema.name.toLowerCase().replace(/[^\w\u00C0-\u024f]+/g, "-").replace(/^-+|-+$/g, '')}" class="shopify-section${schema.class ? ` ${schema.class}` : ''}">${output}</div>`;

        return formattedOutput;
      }
    });

    engine.registerTag('stylesheet', {
      parse: function (token, remainTokens) {
        this.processor = token.args;

        this.tokens = [];
        const stream = this.liquid.parser.parseStream(remainTokens);
        stream
          .on('token', (token) => {
            if (token.name === 'endstylesheet') {
              stream.stop();
            } else {
              this.tokens.push(token);
            }
          })
          .on('end', () => {
            throw new Error(`tag ${token.getText()} not closed`);
          });

        stream.start();
      },
      render: async function (ctx, hash) {
        const quoted = /^'[^']*'|"[^"]*"$/;

        const sassProcessor = (data) => {
          return new Promise((resolve, reject) => renderSass(
            { data },
            (err, result) => err ? reject(err) : resolve('' + result.css))
          );
        };

        const processors = {
          '': x => x,
          'sass': sassProcessor,
          'scss': sassProcessor
        };

        let processor = '';
        if (quoted.exec(this.processor)) {
          const template = this.processor.slice(1, -1);
          processor = await this.liquid.parseAndRender(template, ctx.getAll(), ctx.opts);
        }

        const text = this.tokens.map((token) => token.getText()).join('');

        const p = processors[processor];
        if (!p) {
          throw new Error(`processor for ${processor} not found`);
        }

        const css = await p(text);
        return `<style>${css}</style>`;
      }
    });

    engine.registerTag('javascript', {
      parse: function (token, remainTokens) {
        this.tokens = [];
        const stream = this.liquid.parser.parseStream(remainTokens);
        stream
          .on('token', (token) => {
            if (token.name === 'endjavascript') {
              stream.stop();
            } else {
              this.tokens.push(token);
            }
          })
          .on('end', () => {
            throw new Error(`tag ${token.getText()} not closed`);
          });

        stream.start();
      },
      render: async function (ctx, hash) {
        const text = this.tokens.map((token) => token.getText()).join('');
        return `<script>${text}</script>`;
      }
    });

    engine.registerFilter('asset_url', value => `/assets/${value}`);

    engine.registerFilter('img_url', value => typeof value === 'object' ? value.src : value);

    engine.registerFilter('handle', value => value && value.toLowerCase().replace(/[^\w\u00C0-\u024f]+/g, "-").replace(/^-+|-+$/g, ''));

    engine.registerFilter('money', value => value && `$${parseFloat(value) / 100}`);
  },

  spawnFile: function(config, fileName) {
    const paths = config.paths;
    const metaFilePath = path.resolve(paths.source.meta, fileName);

    try {
      fs.statSync(metaFilePath);
    } catch (err) {
      //not a file, so spawn it from the included file
      const localMetaFilePath = path.resolve(__dirname, '_meta/', fileName);
      const metaFileContent = fs.readFileSync(
        path.resolve(__dirname, '..', '_meta/', fileName),
        'utf8'
      );
      fs.outputFileSync(metaFilePath, metaFileContent);
    }
  },

  /**
   * Checks to see if the _meta directory has engine-specific head and foot files,
   * spawning them if not found.
   *
   * @param {object} config - the global config object from core, since we won't
   * assume it's already present
   */
  spawnMeta: function(config) {
    this.spawnFile(config, '_head.liquid');
    this.spawnFile(config, '_foot.liquid');
  },
};
