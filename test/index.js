'use strict';

var assert = require('assert');
var Promise = require('bluebird');
var td = require('testdouble');

require('..');

var A = Class({}, 'A')({
  prototype: {
    init: function (opts) {
      var that = this;
      Object.keys(opts || {}).forEach(function (key) {
        that[key] = opts[key];
      });
    },

    save: function () {
      return Promise.resolve(this);
    }
  },
});

var B = Class({}, 'B').inherits(A).includes(AttachmentsProcessor)({});

var exPath = __dirname + '/file.txt';

describe('AttachmentsProcessor', function () {

  it('Should add the correct constructor and prototype properties when included', function () {
    // constructor
    assert.equal(B.pathPropName, 'path');
    assert.equal(B.metaPropName, 'meta');
    assert.equal(B.uploaderInstance, null);
    assert.equal(B.PROCESSOR_VERSIONS, null);
    assert.equal(typeof B.processFile, 'function');

    // prototype
    assert.equal(B.prototype.parsedPaths, null);
    assert.equal(B.prototype._processStreams, null);
    assert.equal(typeof B.prototype.uploadProcessedFiles, 'function');
    assert.equal(typeof B.prototype.parsePaths, 'function');
  });

  describe('::processFile()', function () {

    afterEach(function () {
      td.reset();
    });

    it('Should call uploadInstance#checkConstraints once', function () {
      var u = {
        checkConstraints: td.function(),
      };

      // We throw so that then the rest of the process stops
      // We can tell it was called if it throws
      td.when(u.checkConstraints(exPath)).thenThrow(new Error('cannot touch this!'));

      var C = Class({}, 'C').inherits(B)({
        uploaderInstance: u,
      });

      return C.processFile(exPath)
        .then(function () {
          throw 'should not have gotten here';
        })
        .catch(function (err) {
          assert.ok(err instanceof Error);
          assert.equal(err.message, 'cannot touch this!');
        });
    });

    it('Should return a model with the correct properties', function () {
      var u = {
        checkConstraints: function () {},
        uploadStream: function () {},
      };

      var C = Class({}, 'C').inherits(B)({
        uploaderInstance: u,
      });

      return C.processFile(exPath)
        .then(function (model) {
          return model.uploadProcessedFiles();
        })
        .then(function (model) {
          assert.ok(model instanceof C);
          assert.equal(model.id.length, 36);

          assert.deepEqual(model.meta.versions.original, {
            ext: 'txt',
            meta: {},
          });

          var expPath = [
            '/',
            model.id,
            '_{{versionName}}.{{ext}}',
          ].join('');

          assert.equal(model.path, expPath);
        });
    });

    it('Should call all the processors only once', function () {
      var u = {
        checkConstraints: function () {},
        uploadStream: function () {},
      };

      var x = td.function();
      var y = td.function();

      td.when(x(td.matchers.anything())).thenReturn(td.function());
      td.when(y(td.matchers.anything())).thenReturn(td.function());

      var C = Class({}, 'C').inherits(B)({
        uploaderInstance: u,
        PROCESSOR_VERSIONS: [
          {
            versionName: 'X',
            ext: 'txt',
            meta: {},
            processor: x,
          },
          {
            versionName: 'Y',
            ext: 'txt',
            meta: {},
            processor: y,
          },
        ],
      });

      return C.processFile(exPath)
        .then(function (model) {
          td.verify(x(td.matchers.anything()), { times: 1 });
          td.verify(y(td.matchers.anything()), { times: 1 });
        });
    });

  });

  describe('#uploadProcessedFiles()', function () {

    afterEach(function () {
      td.reset();
    });

    it('Should call uploadInstance#uploadStream() the correct amount of times', function () {
      var u = {
        checkConstraints: function () {},
        uploadStream: td.function(),
      };

      var x = td.function();
      var y = td.function();

      td.when(x(td.matchers.anything())).thenReturn(td.function());
      td.when(y(td.matchers.anything())).thenReturn(td.function());

      var C = Class({}, 'C').inherits(B)({
        uploaderInstance: u,
        PROCESSOR_VERSIONS: [
          {
            versionName: 'X',
            ext: 'txt',
            meta: {},
            processor: x,
          },
          {
            versionName: 'Y',
            ext: 'txt',
            meta: {},
            processor: y,
          },
        ],
      });

      return C.processFile(exPath)
        .then(function (model) {
          return model.uploadProcessedFiles();
        })
        .then(function (model) {
          td.verify(u.uploadStream(td.matchers.anything(), td.matchers.anything()), { times: 3 });
        });
    });

    it('Should call the model\'s #save() once', function () {
      var u = {
        checkConstraints: function () {},
        uploadStream: function () {},
      };

      var C = Class({}, 'C').inherits(B)({
        uploaderInstance: u,
        prototype: {
          save: td.function(),
        },
      });

      td.when(C.prototype.save()).thenResolve();

      return C.processFile(exPath)
        .then(function (model) {
          return model.uploadProcessedFiles();
        })
        .then(function (model) {
          td.verify(C.prototype.save(), { times: 1 });
        });
    });

  });

  describe('#parsePaths()', function () {

    it('Should populate #parsedPaths with the correct results', function () {
      var m = new B({
        path: '{{versionName}}.{{ext}}',
        meta: {
          versions: {
            X: {
              ext: 'Y',
            },
            B: {
              ext: 'M',
            },
            K: {
              ext: 'A',
            }
          },
        },
      });

      m.parsePaths();

      var exp = [
        'X.Y',
        'B.M',
        'K.A',
      ];

      assert.deepEqual(m.parsedPaths, exp);
    });

  });

});
