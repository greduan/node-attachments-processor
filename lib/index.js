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

  processFile: function (srcPath, mimeType) {
    var that = this;

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
      var ext = path.extname(srcPath);
      var _id = uuid.v4();

      var originalProcessor = {
        ext: ext,
        versionName: 'original',
        meta: {},
        processor: function (fileReadable) {
          return fileReadable;
        },
      };

      /*
       * CREATE PROCESSOR VERSIONS ARRAY WITH ORIGINAL PROCESSOR ADDED
       */

      var processorVersions = _.clone(that.PROCESSOR_VERSIONS) || [];
      processorVersions.push(originalProcessor);

      /*
       * LOOP THROUGH PROCESSORS
       */

      var processorStreams = [];

      processorVersions.forEach(function (definition) {
        var fileStream = fs.createReadStream(srcPath);
        var stream = definition.processor(fileStream);

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
          stream: stream,

          // Content-Type
          type: mimeType || 'binary/octet-stream',
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
          return uploaderInstance.uploadStream(processor)
            .then(function (data) {
              Object.keys(data).forEach(function (key) {
                that[that.constructor.metaPropName][key.toLowerCase()] = data[key];
              });
            });
        })
        .then(function () {
          return that.save();
        });
    },

    parsePaths: function () {
      var that = this;

      this.parsedPaths = [];

      Object.keys(this[this.constructor.metaPropName].versions).forEach(function (key) {
        var version = that[that.constructor.metaPropName].versions[key];
        var name = key;
        var ext = version.ext;

        var newPath = that[that.constructor.pathPropName]
          .replace('{{versionName}}', name)
          .replace('{{ext}}', ext)

          // remove trailing dot
          .replace(/\.$/, '')

        that.parsedPaths.push(newPath);
      });

      return this;
    },

  },

});
