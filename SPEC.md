# AttachmentsProcessor spec

## Intro

We need a way to process files (Attachments) into different versions and declare
what those different versions are in a simple manner.

We also need a way to decode the `path` and `meta` variables in order to get a
URL for all the processed versions.

## Problem discovery/definition

### Background

#### What do we need?

We need a module that extends Krypton models that allows the model to process a
file (with any process) before uploading it to S3 and then upload it to S3.

And then allow us to only store a path template for the uploaded files but be
able to generate, from the path template, the path to all the processed
versions.

#### What have we built like this?

CrowdVoice.by's ImageUploader module, which contrary to the module's name, also
includes processing the files:
https://github.com/Empathia/crowdvoice.by/blob/master/lib/image_uploader.js

Its usage can be observed in the Voice, Post and Entity models:

- https://github.com/Empathia/crowdvoice.by/blob/master/models/Voice.js
- https://github.com/Empathia/crowdvoice.by/blob/master/models/Post.js
- https://github.com/Empathia/crowdvoice.by/blob/master/models/Entity.js

#### Why are those solutions not satisfactory?

Any combination of the following:

- Too verbose
- Unclear API
- Sloppy code/implementation
- No documentation
- Too terse, only covers that specific use-case

### Constraints

- Must be a Neon `Module` , to be useable by Krypton models.
- Must use S3Uploader for uploading the files.

### Assumptions

- Processors will always be able to return a readable Stream.
- Will be used to extend Krypton models.
- S3Uploader:
  - Has an `#uploadFileFromStream()` method.
- Will be used with Multer, i.e. a path to a file will be available.
- There will be an `Attachments` main model, which'll keep track of all the
  Attachments, i.e. things that are uploaded. More info in the Usage examples.
- Models that make use of this module use UUIDs as their `id` field in the DB.

### Research

#### Similar tools

- https://github.com/technoweenie/attachment_fu (RoR)
- CrowdVoice.by's ImageUploader:
  - https://github.com/Empathia/crowdvoice.by/blob/master/lib/image_uploader.js
  - https://github.com/Empathia/crowdvoice.by/blob/master/models/Voice.js
  - https://github.com/Empathia/crowdvoice.by/blob/master/models/Post.js
  - https://github.com/Empathia/crowdvoice.by/blob/master/models/Entity.js

#### Resources

- https://github.com/greduan/node-s3-uploader

## Solution proposal

### Blackbox

#### General "upload a file" flow

![](https://www.lucidchart.com/publicSegments/view/c901c984-d493-4a10-9669-4fc41f495b36/image.png)

### Functional spec

#### Module `AttachmentsProcessor`

##### For processing

###### `::PROCESSOR_VERSIONS`

Default: `null`

Holds the information for the processor to know what versions to generate. Each
processor will modify the file it is given into a different version of the
file. For example with images it'd be changing its size or different compression
algorithms.

Should be an array with the format-defining objects, general format for the
object would be:

```
{
  versionName: String, // {{versionName}}
  ext: String, // {{ext}}
  processor: function (fileReadable) { // file processor
    // where fileReadable is a readable stream of the file, to be piped wherever
  },
  meta: Object, // can have any JSON-able property
}
```

`name`, `ext` and `meta` are used to generate the new models's `meta` property.

The `processor` will:

- Be treated as a Promise.
- Receive as argument a readable Stream of the file so you can pipe it into a
  transform Stream.
- Return (in the resolved Promise) a transform (or readable) Stream which
  outputs the processed version of the file.

###### `::processFile(srcPath)`

Takes the file given in the `srcPath` arg and passes it through the processes
defined in `::PROCESSOR_VERSIONS`.

Returns a new model instance (using `this` , which points to the current
constructor) with some predefined data according to what it just processed.

It predefines the following:

- Sets `#_processStreams` which is an array of objects containing the
  information necessary to upload all the processed versions, generated from
  `::PROCESSOR_VERSIONS`
- Sets `#path` (or whatever is defined using `::pathPropName`)
- Sets `#meta` (or whatever is defined using `::metaPropName`)

If the processor's `versionName` property's value is `original` it'll throw.

###### Processor that will always run

This is the only processor that will run if `::PROCESSOR_VERSIONS` is `null` ,
and it will always run even if other processors are defined.

This processor:

- Has a `versionName` value of `'original'`
- Has an `ext` value which is the same as the input `srcPath`'s
- Has a `meta` value of `{}` (empty object)
- Has a processor function which just returns the Stream it is passed in as an
  argument (`fileReadable`)

This processor defines no particular meta.

##### For path parsing

###### `::pathPropName`

Default: `'path'`

Name of the instance's property that will be used to find the template path of
the file when creating the different version's URLs.

Will be used by `#parsePaths()`.

###### `::metaPropName`

Default: `'meta'`

Name of the instance's property that will be used to find the metadata for the
path when creating the different versions URLs.

Will be used by `#parsePaths()`.

###### Model's metadata property

Its property name is defined by `::metaPropName`.

Used by `#parsePaths()` to parse the different versions of the path to the file.

And used by those consuming the model, for the extra metadata.

It looks something like the following:

```json
{
  "versions": {
    "original": {
      "ext": "bar",
      "meta": {}
    },
    "foo": {
      "ext": "bar",
      "meta": {
        "too": 600,
        "koo": 800
      }
    },
    "zoo": {
      "ext": "zar",
      "meta": {
        "too": 800,
        "koo": 1280
      }
    }
  }
}
```

######  `#parsedPaths`

Generated by `#parsePaths()` and may look something like the following:

```json
{
  "foo": "/attachments/36776fd2-0ce5-473f-b100-5f15826b64a1_foo.png",
  "bar": "/attachments/36776fd2-0ce5-473f-b100-5f15826b64a1_bar.png",
  "baz": "/attachments/36776fd2-0ce5-473f-b100-5f15826b64a1_baz.png",
}
```

Meant to be used by the front end (or whoever) to know where to download the
file from.

######  `#parsePaths()`

Uses `::pathPropName` and `::metaPropName` to get the path to parse and the
available meta info to parse it.

Generates an object which contains all the variations it can create with the
provided path and meta.

It expects the meta property to have at least the following properties, it may
have any amount of other stuff but it only needs the following to parse the
paths:

```json
{
  "versions": {
    "foo": {
      "ext": "bar"
    },
    "zoo": {
      "ext": "baz"
    }
  }
}
```

Assigns the generated object to `#parsedPaths` and returns `this` so it's
concatenable.

##### For uploading the processed versions

###### `::uploaderInstance`

Default: `null`

The S3Uploader instance `#uploadProcessedFiles()` will use to upload the
transform Streams for the processors.

###### `#_processStreams`

Holds an array of objects that contains the necessary information to use the
S3Uploader instance to upload the different versions of the file.

Each object looks something like:

```js
// Note the "original" below is the {{versionName}}, in this case "original"
{
  path: '/8c27c10c-d6a6-4101-9caf-b277bd3a3293_original.png',
  stream: ReadableStream,
}
```

Where:

-  `path` is the variable that will be passed as `destPath` to the S3Uploader
   method.
-  `stream` is a readable Stream which will be used to upload through
   S3Uploader.

###### `#uploadProcessedFiles(uploaderInstance)`

Loops through `#_processStreams` and uploads each to S3 using
`::uploaderInstance` 's method to upload from readable Streams. If the
`uploaderInstance` argument is provided it should use that S3Uploader instance
instead of the Class' default one.

Gives the function's argument `destPath` the `path` property of the object we're
looping over from `#_processStreams` .

When all files are uploaded properly it then saves the model using the model's
`#save()` and returning the Promise that that method generates.

## Solution

### Technical spec

#### Module `AttachmentsProcessor`

A Neon Module meant to be included in any Krypton ORM model

##### `::processFile(<String> srcPath)`

###### Arguments

-  `srcPath` , String, the path to the file that will be processed and later
   uploaded.

###### Returns

A new model instance that has had some properties pre-defined and an `id` value
set.

One can call `#uploadProcessedFiles()` on this returned model right away.

###### Side-effects

None.

###### Typical use case

```js
Attachment.processFile('/tmp/randomimage.png');
// ^ returns Attachment instance so you can continue to chain other methods,
// like .uploadProcessedFiles()
```

###### Pseudo-code

Note that throughout this pseudo-code, at the top level `this` points to the
model's constructor, at least in Neon it does.

```
Set resultModel to: new this
Set that to: this

Set resultModel.id to:
  Call uuid.v4()

/*
 * CREATE THE ORIGINAL PROCESSOR
 */

Set ext to:
  Call .split() on srcPath with arguments:
    1. "."
  Chain Call .reverse()
  Get first element in array // [0]

Set originalProcessor to: Object:
  {
    ext: ext,
    versionName: "original",
    meta: {},
    processor: function with named arguments: fileReadable
      Return Call Promise.resolve() with arguments:
        1. fileReadable
  }

/*
 * CREATE PROCESSOR VERSIONS ARRAY WITH ORIGINAL PROCESSOR ADDED
 */

Set processorVersions to:
  Call _.clone() with arguments:
    1. this.PROCESSOR_VERSIONS
  OR if null set as []
Call .push() on processorVersions with arguments:
  1. originalProcessor

/*
 * LOOP THROUGH PROCESSORS
 */

Set processorStreams to: []

Call .forEach() on processorVersions with arguments:
  1. function with named arguments: definition
    Set fileStream to:
      Call fs.createReadStream() with arguments:
        1. srcPath

    // Get stream
    Set stream to:
      Call to definition.processor() with arguments:
        1. fileStream

    // Get path
    Set path to:
      Concatenate:
        "/"
        resultModel.id
        "_"
        definition.versionName
        "."
        definition.ext

    Set processor to: Object:
      {
        path: path,
        stream: stream,
      }

    Call .push() processorStreams with arguments:
      1. processor

Set resultModel._processorStreams to: processorStreams

/*
 * POPULATE NEW MODEL'S META
 */

Set resultModel[that.metaPropName] to: Object:
  {
    versions: {},
  }

Call .forEach() on processorVersions with arguments:
  1. function with named arguments: definition
    Set resultModel[that.metaPropName][definition.versionName] to: Object:
      {
        ext: definition.ext,
        meta: definition.meta,
      }

Return resultModel
```

##### `#uploadProcessedFiles([<S3Uploader> uploaderInstance])`

###### Arguments

-  `uploaderInstance` , Optional, an S3Uploader instance that will be used to
   upload the files instead of `::uploaderInstance` .

###### Returns

Promise which resolves after files have been uploaded and the model has been
saved to the DB.

###### Side-effects

- S3 bucket has new files.
- DB has a new record.

###### Typical use case

```
Attachment
  .processFile('/tmp/randomimage.png')
  .uploadProcessedFiles()
  .then(...)
  .catch(...);
```

###### Pseudo-code

```
Set that to: this

If uploaderInstance is undefined
  Set uploaderInstance to: this.constructor.uploaderInstance

Return Call Promise.each() with arguments:
  1. this._processorStreams
  2. function with named arguments: processor
    Return Call uploaderInstance.uploadFileFromStream() with arguments:
      1. processor.stream
      2. processor.path
Chain Call .then() with arguments:
  1. function with no arguments
    Return Call that.save()
```

##### `#parsePaths()`

###### Arguments

None.

###### Returns

The model instance, i.e. `this` .

###### Side-effects

Sets `#parsedPaths` to be an object, check the functional spec section on
`#parsedPaths` for more info on its format.

###### Typical use case

```
Attachment
  .processFile('/tmp/randomimage.png')
  .uploadProcessedFiles()
  .then(function (model) {
    model.parsePaths();
  })
  .catch(...);
```

###### Pseudo-code

```
Set this.parsedPaths to: []
Set that to: this

Call Object.keys() with arguments:
  1. this[this.constructor.metaPropName].versions
Chain Call .forEach() with arguments:
  1. function with named arguments: key
    Set version to: that[that.constructor.metaPropName].versions[key]
    Set name to: key
    Set ext to: version.ext

    Set newPath to:
      Call .replace() on that[that.constructor.pathPropName] with arguments:
        1. "{{versionName}}"
        2. name
      Chain Call .replace() with arguments:
        1. "{{ext}}"
        2. ext

    Call .push() on that.parsedPaths with arguments:
      1. newPath

Return this
```

---

I think I won't need to define these, since they are only used by the the above,
so they have very little to spec technically, if anything at all.

Their usage and function is already described in the functional spec.

-  `::PROCESSOR_VERSIONS`
-  `::pathPropName`
-  `::metaPropName`
-  `::uploaderInstance`
-  `#parsedPaths`
-  `#_processStreams`

## Usage examples

This module is meant to be used in a workflow where *any* attachments that the
system needs to upload to S3 are stored in one table called `Attachments` , this
is to keep it modular and easily extensible.

The general use case, then, defines an Attachment model:

```js
Class('Attachment').includes(AttachmentsProcessor)({
  tableName: 'Attachments',
  validations: {...},
  attributes: ['id', 'type', 'path', 'meta', 'created_at', 'updated_at'],

  // AttachmentsProcessor stuff
  PROCESSOR_VERSIONS: null,
  uploaderInstance: null,
});
```

Please note the `type` property, this'd be `avatar` or `background` depending on
the kind of Attachment it is (both of these are defined below), and it would be
the metadata regarding which sub-model was used to process that particular
record.  This sort of thing comes down to how you prefer to implement the
differentiation between the different sorts of Attachments, I just use the
`type` field as an example here.

Then one usually needs to upload different kinds of Attachments, images,
documents, images that are avatars, images that are backgrounds, etc. That in
itself is not a problem, the problem is one wants to have different processors
for these different kinds of attachments.

In that case one goes on to inherit from the `Attachment` model for the
different attachment types, like so:

```js
/*
 * Avatar Attachment
 */

var avatarUploader = new S3Uploader({
  pathPrefix: '/attachments/avatar',
  // S3 credentials
});

Class('AttAvatar').inherits(Attachment)({
  PROCESSOR_VERSIONS: [
    {
      versionName: 'normal',
      ext: 'png',
      processor: function (fileReadabe) {
        var avatarProcessor = ...;
        fileReadable.pipe(avatarProcessor);
        // avatarProcessor is a transform stream
        return avatarProcessor;
      },
      meta: {
        width: 100,
        height: 100,
      },
    },
  ],
  instanceUploader: avatarUploader,

  prototype: {
    type: 'avatar',
  },
});

/*
 * Background Attachment
 */

var backgroundUploader = new S3Uploader({
  pathPrefix: '/attachments/background',
  // S3 credentials
});

Class('AttBackground').inherits(Attachment)({
  PROCESSOR_VERSIONS: [
    {
      versionName: 'normal',
      ext: 'png',
      processor: function (fileReadabe) {
        var bgProcessor = ...;
        fileReadable.pipe(bgProcessor);
        // bgProcessor is a transform stream
        return bgProcessor;
      },
      meta: {
        width: 800,
        height: 300,
      },
    },

    {
      versionName: 'big',
      ext: 'png',
      processor: function (fileReadabe) {
        var bgProcessor = ...;
        fileReadable.pipe(bgProcessor);
        // bgProcessor is a transform stream
        return bgProcessor;
      },
      meta: {
        width: 1280,
        height: 500,
      },
    },
  ],
  instanceUploader: backgroundUploader,

  prototype: {
    type: 'background',
  },
});
```

That covers having different processors for different kinds of attachments.

Another use case, one table (named `Accounts`) which has several things it can
hold as an upload, for example a background and an avatar for the Account.

In this case the table would have a `bg_attachment_id` and a
`avatar_attachment_id` columns, these would point to records in the
`Attachments` table which would hold the specific info for that particular
Attachment.

Usage examples of above code examples

```js
/*
 * Available models:
 * - Attachment
 * - AttAvatar
 * - AttBackground
 */

AttAvatar
  .processFile('/tmp/randomimage.png')
  .uploadProcessedFiles()
  .then(function (model) {
    model.parsePaths();
    /*
      * model.parsedPaths =
      *   {
      *     "normal": '/attachments/36776fd2-0ce5-473f-b100-5f15826b64a1_normal.png',
      *     "original": '/attachments/36776fd2-0ce5-473f-b100-5f15826b64a1_original.png',
      *   }
      */
    res.json(model);
  })
  .catch(...);

AttBackground
  .processFile('/tmp/randomstringimage.png')
  .uploadProcessedFiles()
  .then(function (model) {
    model.parsePaths();
    /*
     * model.parsedPaths =
     *   {
     *     "normal": '/attachments/edcc367e-07d8-456d-8acf-62d0024f6add_normal.png',
     *     "big": '/attachments/edcc367e-07d8-456d-8acf-62d0024f6add_big.png',
     *     "original": '/attachments/edcc367e-07d8-456d-8acf-62d0024f6add_original.png',
     *   }
     */
    res.json(model);
  })
  .catch(...);
```
