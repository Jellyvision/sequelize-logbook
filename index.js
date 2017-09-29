/**
 * @mixin SequelizeRevisions
 * @desc A mixin for adding a revision history / audit / paper trail to a sequelize model
 *
 */
const _ = require('lodash');
const Sequelize = require('sequelize');

function getPrimaryKey(Model) {
  return Object.keys(Model.attributes).filter(field => {
    return Model.attributes[field].primaryKey;
  })[0];
}
/**
 * @function trackRevisions
 * @memberOf SequelizeRevisions
 * @param {SequelizeModel}   Model   - The model you want revisions tracked on
 */
module.exports = function trackRevisions(Model) {
  if (!Model) {
    return;
  }
  const modelNameSuffix = '_revision';
  const omittedAttributes = ['createdAt', 'updatedAt', 'deletedAt'];
  const fieldsToIgnore = [
    'primaryKey',
    'autoIncrement',
    'unique',
    'onUpdate',
    'onDelete',
    'references',
  ];
  const revisionAttributes = {
    revisionId: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: Sequelize.INTEGER,
    },
    revisionValidFrom: {
      type: Sequelize.DATE,
      defaultValue: null,
      validate: [
        value => {
          if (!(value instanceof Date)) {
            throw new Error('revisionValidFrom is Date');
          }
        },
      ],
    },
    revisionValidTo: {
      type: Sequelize.DATE,
      defaultValue: null,
      validate: [
        value => {
          if (!(value instanceof Date)) {
            throw new Error('revisionValidTo is Date');
          }
        },
      ],
    },
    whoDunnit: {
      type: Sequelize.STRING,
      defaultValue: null,
    },
  };

  const sequelize = Model.sequelize;
  const referenceModelPrimaryKey = getPrimaryKey(Model);
  const trackedAttributes = _.reduce(
    _.omit(Model.attributes, omittedAttributes),
    function(map, attributeDef, attributeName) {
      if (attributeDef.type.key !== 'VIRTUAL') {
        map[attributeName] = _.omit(attributeDef, fieldsToIgnore);
      }
      return map;
    },
    {}
  );
  const attributes = _.merge(revisionAttributes, trackedAttributes);

  const revisionModel = sequelize.define(
    Model.name + modelNameSuffix,
    attributes,
    {
      timestamps: false,
      paranoid: false,
      indexes: [
        {
          fields: ['revisionValidFrom'],
        },
        {
          fields: ['revisionValidTo'],
        },
        {
          fields: [referenceModelPrimaryKey],
        },
      ],
      classMethods: {
        associate: associateFunction,
      },
    }
  );

  function associateFunction() {
    function ensureNoPreviousRevision(record, options) {
      const findOptions = {
        where: {
          revisionValidTo: null,
        },
        transaction: options.transaction,
      };
      findOptions.where[referenceModelPrimaryKey] =
        record[referenceModelPrimaryKey];

      return revisionModel.findOne(findOptions).then(revisionRecord => {
        if (revisionRecord) {
          return Sequelize.Promise.reject('previous revision on create');
        }
      });
    }
    function ensurePreviousRevisionExists(record, options) {
      const findOptions = {
        where: {
          revisionValidTo: null,
        },
        transaction: options.transaction,
      };
      findOptions.where[referenceModelPrimaryKey] =
        record[referenceModelPrimaryKey];

      return revisionModel.findOne(findOptions).then(function(revisionRecord) {
        if (!revisionRecord) {
          return Sequelize.Promise.reject('no previous revision exists');
        }
      });
    }
    function saveNewRevision(record, options) {
      const newFields = _.omit(record.dataValues, omittedAttributes);
      const fallback =
        process.env.whoDunnit || 'unknown user: ' + process.env.NODE_ENV;
      newFields.whoDunnit = sequelize.whoDunnit || fallback;

      return revisionModel.create(newFields, {
        transaction: options.transaction,
      });
    }
    function saveFinalRevision(record, options) {
      const findOptions = {
        where: {
          revisionValidTo: null,
        },
        transaction: options.transaction,
      };
      findOptions.where[referenceModelPrimaryKey] =
        record[referenceModelPrimaryKey];

      return revisionModel.findOne(findOptions).then(finalRevisionRecord => {
        return finalRevisionRecord.update(
          {
            revisionValidTo: new Date(),
          },
          {
            transaction: options.transaction,
          }
        );
      });
    }

    // we want these revisions hooks to get raw db data
    // so we need them to run before any other `after...` hooks
    // so unshift() instead of addHook()
    Model.options.hooks.afterCreate = Model.options.hooks.afterCreate || [];
    Model.options.hooks.afterCreate.unshift(saveNewRevision);
    Model.options.hooks.afterCreate.unshift(ensureNoPreviousRevision);

    Model.options.hooks.afterUpdate = Model.options.hooks.afterUpdate || [];
    Model.options.hooks.afterUpdate.unshift(saveNewRevision);
    Model.options.hooks.afterUpdate.unshift(ensurePreviousRevisionExists);

    Model.options.hooks.afterDestroy = Model.options.hooks.afterDestroy || [];
    Model.options.hooks.afterDestroy.unshift(saveFinalRevision);
    Model.options.hooks.afterDestroy.unshift(ensurePreviousRevisionExists);
  }

  function ensureValidFromAndValidToNotSet(record) {
    if (record.revisionValidFrom !== null) {
      throw new Error('revisionValidFrom cannot be set manually');
    }
    if (record.revisionValidTo !== null) {
      throw new Error('revisionValidTo cannot be set manually');
    }
  }
  function setValidToOnPreviousAndValidFromOnCurrent(record, options) {
    const findOptions = {
      where: {
        revisionValidTo: null,
      },
      transaction: options.transaction,
    };
    findOptions.where[referenceModelPrimaryKey] =
      record[referenceModelPrimaryKey];
    return revisionModel.findOne(findOptions).then(function(previousRecord) {
      const timestamp = new Date();
      record.revisionValidFrom = timestamp;
      return previousRecord
        ? previousRecord.update(
            {
              revisionValidTo: timestamp,
            },
            {
              transaction: options.transaction,
            }
          )
        : undefined;
    });
  }
  function ensureOnlyUpdatingValidToOnce(record) {
    if (
      _.includes(_.values(_.omit(record._changed, ['revisionValidTo'])), true)
    ) {
      throw new Error('cannot update revision');
    } else if (record._previousDataValues.revisionValidTo) {
      throw new Error('revisionValidTo already set');
    }
  }
  function ensureNotDeleting() {
    throw new Error('cannot delete revision');
  }

  revisionModel.addHook('beforeCreate', ensureValidFromAndValidToNotSet);
  revisionModel.addHook(
    'beforeCreate',
    setValidToOnPreviousAndValidFromOnCurrent
  );
  revisionModel.addHook('beforeUpdate', ensureOnlyUpdatingValidToOnce);
  revisionModel.addHook('beforeDestroy', ensureNotDeleting);
  revisionModel.associate();

  return revisionModel;
};
