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

  PROCESSOR_VERSIONS: null,
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

      resultModel.extName = ext;
      resultModel.srcPath = srcPath;
      resultModel.mimeType = mimeType;

      var originalProcessor = {
        ext: ext,
        versionName: 'original',
        meta: {},
        processor: function (fileReadable) {
          return Promise.resolve(fileReadable);
        },
      };

      /*
       * CREATE PROCESSOR VERSIONS ARRAY WITH ORIGINAL PROCESSOR ADDED
       */

      var processorVersions = _.clone(that.PROCESSOR_VERSIONS).filter(function (definition) {
        if (mimeType && definition.matchMimeType && definition.matchMimeType.test(mimeType)) {
          return true;
        }
      }) || [];

      processorVersions.push(originalProcessor);

      /*
       * LOOP THROUGH PROCESSORS
       */

      var processorStreams = [];

      processorVersions.forEach(function (definition) {
        if (!definition.ext) {
          // override with original extension
          definition.ext = originalProcessor.ext;
        }

        var path = [
          '/',
          _id,
          '_',
          definition.versionName,

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
        versions: {},
      };

      processorVersions.forEach(function (definition) {
        resultModel[that.metaPropName].versions[definition.versionName] = {
          ext: definition.ext,
          meta: definition.meta,
        };
      });

      resultModel.path = [
        that.uploaderInstance._pathPrefix,
        '/',
        _id,
        '_{{versionName}}.{{ext}}',
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
          processor.stream = fs.createReadStream(that.srcPath);

          return Promise.resolve(processor.processor(processor.stream, processor.meta || {}))
            .then(function (_stream) {
              var payload = {
                stream: _stream,
                path: processor.path,
                ext: _stream.extension || that.extName,
                type: _stream.mimeType || that.mimeType,
              };

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

      Object.keys(this[this.constructor.metaPropName].versions).forEach(function (key) {
        var version = that[that.constructor.metaPropName].versions[key];
        var name = key;
        var ext = version.ext;

        var newPath = that[that.constructor.pathPropName]
          .replace('{{versionName}}', name)
          .replace('{{ext}}', ext)

          // remove trailing dot
          .replace(/\.$/, '')

        var _meta = {};

        if (version.meta) {
          Object.keys(version.meta).forEach(function (_key) {
            _meta[_key] = version.meta[_key];
          });
        }

        // fix newPath url
        _meta.location = that[that.constructor.metaPropName]
          .location.replace(that[that.constructor.metaPropName].key, newPath);

        that.parsedPaths[name] = _meta;
      });

      return this;
    },

  },

});
