# Sequelize-Logbook

A plugin for adding a log book / revision history / audit / [paper trail](https://en.wiktionary.org/wiki/paper_trail) to a sequelize model.

# 🎛 Usage

## When using the [models/index.js](https://github.com/sequelize/express-example/blob/master/models/index.js) `associate` pattern: 
`my-model.js`
```javascript
const trackRevisions = require('sequelize-logbook')

module.exports = function(sequelize, DataTypes) {
  let MyModel = sequelize.define('MyModel', {
    ...
    classMethods: {
      ...
      associate: function(){
        ...
        trackRevisions(MyModel)
      }
    }
  })
}

```

## General use
```javascript
const trackRevisions = require('sequelize-logbook')

let MyModel = sequelize.define('MyModel', {...})
let AnotherModel = sequelize.define('AnotherModel', {...})
trackRevisions(MyModel)
trackRevisions(AnotherModel)

```

## 🐲 whoDunnit / blame / author tracking. 

SequelizeRevisions will look against the global sequelize object
for a whoDunnit key. If this key is present, it will save this value
as the author of the revision. 
Otherwise, it'll fall back to process.env.NODE_ENV

```javascript
const sequelize = new Sequelize(db, user, password, config)
sequelize.whoDunnit = 'yourUserString'
```

# ⚠ Caveats

Revisions will **not** be automatically generated for instances created, deleted, or updated with **Bulk** actions
If you want revisions generated for Bulk actions, pass `individualHooks: true` as a sequelize option.

# 🏗 Contributing ![contributions welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg?style=flat)

## 📐 Tests 
`npm run test`

## ✂ Linting
`npm run prettier`

# ✨ Inspired by

* [ssteffl's snippet](https://gist.github.com/ssteffl/f58ce60105c365a8d482)
* [PaperTrail](https://github.com/airblade/paper_trail)

## Related: 

This library is similar to these other packages, with the addition of: 
1. whoDunnit / blame history
2. Unit tests! 📏

* [sequelize-paper-trail](https://www.npmjs.com/package/sequelize-paper-trail) - ⛔ [empty unit tests](https://github.com/nielsgl/sequelize-paper-trail/blob/master/test/index.spec.js)
* [sequelize-temporal](https://github.com/bonaval/sequelize-temporal) - 👴 not maintained
* [sequelize-revisions](https://github.com/bkniffler/sequelize-revisions) - 🚫 no unit tests

# License

Sequelize-logbook is [MIT licensed](./LICENSE]).
