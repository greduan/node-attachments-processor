'use strict';

if (global.Module == null) {
  require('neon');
}

var _ = require('lodash');
var uuid = require('node-uuid');
var fs = require('fs');
var Promise = require('bluebird');

Module('AttachmentsProcessor')({

  PROCESSOR_VERSIONS: null,
  pathPropName: 'path',
  metaPropName: 'meta',
  uploaderInstance: null,

  processFile: function (srcPath) {
    var resultModel = new this;
    var that = this;

    resultModel.id = uuid.v4();

    /*
     * CREATE THE ORIGINAL PROCESSOR
     */

    var ext = srcPath.split('.').reverse()[0];

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

    var processorVersions = _.clone(this.PROCESSOR_VERSIONS) || [];
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
        resultModel.id,
        '_',
        definition.versionName,
        '.',
        definition.ext,
      ].join('');

      var processor = {
        path: path,
        stream: stream,
      };

      processorStreams.push(processor);
    });

    resultModel._processorStreams = processorStreams;

    /*
     * POPULATE NEW MODEL'S META
     */

    resultModel[this.metaPropName] = {
      versions: {},
    };

    processorVersions.forEach(function (definition) {
      resultModel[that.metaPropName][definition.versionName] = {
        ext: definition.ext,
        meta: definition.meta,
      };
    });

    return resultModel;
  },

  prototype: {

    parsedPaths: null,
    _processStreams: null,

    uploadProcessedFiles: function (uploaderInstance) {
      var that = this;

      uploaderInstance = uploaderInstance || this.constructor.uploaderInstance;

      return Promise
        .each(this._processorStreams, function (processor) {
          return uploaderInstance.uploadFileFromStream(processor.stream, processor.path);
        })
        .then(function () {
          return that.save();
        })
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

        that.parsedPaths.push(newPath);
      });

      return this;
    },

  },

});
