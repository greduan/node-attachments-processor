'use strict';

if (global.Module == null) {
  require('neon');
}

var _ = require('lodash');
var uuid = require('node-uuid');
var fs = require('fs');
var path = require('path');
var Promise = require('bluebird');

Module('AttachmentsProcessor')({

  PROCESSOR_VARIATIONS: null,
  pathPropName: 'path',
  metaPropName: 'meta',
  uploaderInstance: null,

  processFile: function (params) {
    var that = this;

    var srcPath = params.path,
        mimeType = params.type;

    return new Promise(function (resolve, reject) {
      var consErr = that.uploaderInstance.checkConstraints(srcPath);

      if (consErr instanceof Error) {
        return Promise.reject(consErr);
      }

      var resultModel = new that;

      /*
       * CREATE THE ORIGINAL PROCESSOR
       */

      // fixes bad extname values
      var ext = path.extname(params.name || srcPath).substr(1);
      var _id = uuid.v4();

      resultModel._name = path.basename(params.name || srcPath);
      resultModel._extName = ext;
      resultModel._srcPath = srcPath;
      resultModel._mimeType = mimeType;

      var originalProcessor = {
        ext: ext,
        meta: {},
        name: 'original',
        processor: function (fileReadable) {
          return Promise.resolve(fileReadable);
        },
      };

      /*
       * CREATE PROCESSOR VARIATIONS ARRAY WITH ORIGINAL PROCESSOR ADDED
       */

      var processorVariations = _.clone(that.PROCESSOR_VARIATIONS).filter(function (definition) {
        if (mimeType && definition.matchMimeType && definition.matchMimeType.test(mimeType)) {
          return true;
        }
      }) || [];

      processorVariations.push(originalProcessor);

      /*
       * LOOP THROUGH PROCESSORS
       */

      var processorStreams = [];

      processorVariations.forEach(function (definition) {
        if (!definition.ext) {
          // override with original extension
          definition.ext = originalProcessor.ext;
        }

        var path = [
          '/',
          _id,
          '_',
          definition.name,

          // only concatenate if present
          definition.ext ? '.' : '',
          definition.ext,
        ].join('');

        var processor = {
          path: path,
          meta: definition.meta || {},
          processor: definition.processor,
        };

        processorStreams.push(processor);
      });

      resultModel._processorStreams = processorStreams;

      /*
       * POPULATE NEW MODEL'S META
       */

      resultModel[that.metaPropName] = {
        variations: {},
      };

      processorVariations.forEach(function (definition) {
        resultModel[that.metaPropName].variations[definition.name] = {
          ext: definition.ext,
          meta: definition.meta,
        };
      });

      resultModel.path = [
        that.uploaderInstance._pathPrefix,
        '/',
        _id,
        '_{{name}}.{{ext}}',
      ].join('');

      resultModel.save().then(function () {
        resolve(resultModel);
      })
    });
  },

  prototype: {

    parsedPaths: null,
    _processStreams: null,

    uploadProcessedFiles: function (uploaderInstance) {
      var that = this;

      uploaderInstance = uploaderInstance || this.constructor.uploaderInstance;

      return Promise
        .each(this._processorStreams, function (processor) {
          processor.stream = fs.createReadStream(that._srcPath);

          return Promise.resolve(processor.processor(processor.stream, processor.meta || {}))
            .then(function (_stream) {
              var payload = {
                stream: _stream,
                path: processor.path,
                ext: _stream.extension || that._extName,
                type: _stream.mimeType || that._mimeType,
              };

              that[that.constructor.metaPropName].name = that._name;

              if (payload.type) {
                that[that.constructor.metaPropName].mime = payload.type;
              }

              if (_stream && _stream.meta) {
                Object.keys(_stream.meta).forEach(function (key) {
                  that[that.constructor.metaPropName][key] = _stream.meta[key];
                });
              }

              return uploaderInstance.uploadStream(payload)
                .then(function (data) {
                  Object.keys(data).forEach(function (key) {
                    that[that.constructor.metaPropName][key.toLowerCase()] = data[key];
                  });
                });
            });
        })
        .then(function () {
          return that.save();
        });
    },

    parsePaths: function () {
      var that = this;

      // a map is more useful than a plain array
      this.parsedPaths = {};

      Object.keys(this[this.constructor.metaPropName].variations).forEach(function (key) {
        var variation = that[that.constructor.metaPropName].variations[key];
        var name = key;
        var ext = variation.ext;

        var newPath = that[that.constructor.pathPropName]
          .replace('{{name}}', name)
          .replace('{{ext}}', ext)

          // remove trailing dot
          .replace(/\.$/, '')

        var _meta = {};

        if (variation.meta) {
          Object.keys(variation.meta).forEach(function (_key) {
            _meta[_key] = variation.meta[_key];
          });
        }

        // ID for deletion
        _meta.key = newPath;

        // fix newPath url
        _meta.location = that[that.constructor.metaPropName]
          .location.replace(that[that.constructor.metaPropName].key, newPath);

        that.parsedPaths[name] = _meta;
      });

      return this;
    },

  },

});
