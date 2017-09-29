const _ = require('lodash');
const Sequelize = require('sequelize');
const trackRevisions = require('../index');
const fs = require('fs');

function createFakeDB() {
  const fakeDB = new Sequelize('database', 'username', 'password', {
    dialect: 'sqlite',
    storage: __dirname + '/fakedb.sqlite',
    logging: false,
    pool: { maxConnections: 1 },
  });
  fakeDB.destroy = () => {
    fakeDB.close();
    fs.unlinkSync(fakeDB.options.storage);
  };
  return new Promise((resolve, reject) => {
    fakeDB
      .getQueryInterface()
      .dropAllTables()
      .then(() => {
        resolve(fakeDB);
      }, reject);
  });
}

describe('sequelize-revisions', () => {
  let Model, RevisionModel, temporaryDB;
  beforeEach(() => {
    return createFakeDB().then(fakeDB => {
      temporaryDB = fakeDB;
      Model = fakeDB.define('TestModel', {
        name: Sequelize.STRING,
      });
      return Model.sync();
    });
  });
  afterEach(() => {
    temporaryDB.destroy();
  });
  context('when using transactions', () => {
    let transaction, transactionOptions;
    function openTransaction() {
      return temporaryDB.transaction().then(txtn => {
        transaction = txtn;
        transactionOptions = {
          transaction: transaction,
          individualHooks: true,
        };
        return transaction;
      });
    }
    function finishTransaction(result) {
      return transaction.commit().then(() => {
        return result;
      });
    }
    function rollbackTransaction(result) {
      return transaction.rollback().then(() => {
        return Promise.reject(result);
      });
    }
    beforeEach(openTransaction);
    afterEach(() => {
      // with transactions, sqlite gets SQLITE_IOERR
      // due to some random memory thing
      // so throttle it
      return new Promise(resolve => {
        setTimeout(() => {
          resolve(true);
        }, 100);
      });
    });

    it('should not accept invalid models', () => {
      expect(() => {
        trackRevisions(10);
      }).to.throw(Error);
      expect(() => {
        trackRevisions({});
      }).to.throw(Error);
      return finishTransaction();
    });

    context('when given a model', () => {
      describe('the generated revisions model', () => {
        beforeEach(() => {
          return Model.bulkCreate(
            [{ id: '123', name: 'item1' }, { id: '124', name: 'item2' }],
            transactionOptions
          );
        });
        beforeEach(() => {
          RevisionModel = trackRevisions(Model);
          return temporaryDB.sync(transactionOptions);
        });
        afterEach(() => {
          return finishTransaction();
        });

        it('should make name $tableName + _revision', () => {
          expect(RevisionModel.name).to.equal(
            Model.options.name.singular + '_revision'
          );
        });
        it('should add revisionId, revisionFrom, and revisionTo to the model', () => {
          expect(RevisionModel.attributes.revisionId).to.be.defined;
          expect(RevisionModel.attributes.revisionValidFrom).to.be.defined;
          expect(RevisionModel.attributes.revisionValidTo).to.be.defined;
        });
        it('should copy all the original fields into the revisions Table', () => {
          const originalKeys = _.omit(Model.attributes, [
            'updatedAt',
            'createdAt',
            'deletedAt',
          ]);
          expect(RevisionModel.attributes).to.contain.all.keys(originalKeys);
        });
        it('should strip primaryKey, unique, references, onDelete, onUpdate, autoIncrement attributes', () => {
          const dynamicAttributes = _.values(
            _.omit(RevisionModel.attributes, [
              'revisionId',
              'revisionValidFrom',
              'revisionValidTo',
            ])
          );

          const primaryKeys = _.without(
            _.map(dynamicAttributes, 'primaryKey'),
            undefined
          );
          const uniques = _.without(
            _.map(dynamicAttributes, 'unique'),
            undefined
          );
          const referenceses = _.without(
            _.map(dynamicAttributes, 'references'),
            undefined
          );
          const onDeletes = _.without(
            _.map(dynamicAttributes, 'onDelete'),
            undefined
          );
          const onUpdates = _.without(
            _.map(dynamicAttributes, 'onUpdate'),
            undefined
          );
          const autoIncrements = _.without(
            _.map(dynamicAttributes, 'autoIncrement'),
            undefined
          );

          expect(primaryKeys.length).to.equal(0);
          expect(uniques.length).to.equal(0);
          expect(referenceses.length).to.equal(0);
          expect(onDeletes.length).to.equal(0);
          expect(onUpdates.length).to.equal(0);
          expect(autoIncrements.length).to.equal(0);
        });
      });
      describe('a generated revisions instance', () => {
        let modelValues, promise;
        beforeEach(() => {
          RevisionModel = trackRevisions(Model);
          return temporaryDB.sync(transactionOptions);
        });
        beforeEach(() => {
          return Model.create({}, transactionOptions).then(item => {
            modelValues = item.dataValues;
          });
        });
        it('should not allow revisionValidFrom to be set manually', () => {
          const data = _.merge({}, modelValues, {
            revisionValidFrom: new Date(),
          });
          promise = RevisionModel.create(data, transactionOptions)
            .then(finishTransaction)
            .catch(rollbackTransaction);
          expect(promise).to.eventually.be.rejectedWith(
            'revisionValidFrom cannot be set manually'
          );
        });
        it('should not allow revisionValidTo to be set manually', () => {
          const data = _.merge({}, modelValues, {
            revisionValidTo: new Date(),
          });
          promise = RevisionModel.create(data, transactionOptions)
            .then(finishTransaction)
            .catch(rollbackTransaction);
          expect(promise).to.eventually.be.rejectedWith(
            'revisionValidTo cannot be set manually'
          );
        });
        it('should not allow updating model fields', () => {
          const data = _.merge({}, modelValues, {});
          promise = RevisionModel.create(data, transactionOptions)
            .then(revision => {
              return revision.update({ name: 'name' }, transactionOptions);
            })
            .then(finishTransaction)
            .catch(rollbackTransaction);
          expect(promise).to.eventually.be.rejectedWith(
            'cannot update revision'
          );
        });
        it('should not allow deleting', () => {
          const data = _.merge({}, modelValues, {});
          promise = RevisionModel.create(data, transactionOptions)
            .then(revision => {
              return revision.destroy(transactionOptions);
            })
            .then(finishTransaction)
            .catch(rollbackTransaction);
          expect(promise).to.eventually.be.rejectedWith(
            'cannot delete revision'
          );
        });
        context('that is the first revision', () => {
          let revision;
          beforeEach(() => {
            const data = _.merge({}, modelValues);
            return RevisionModel.create(data, transactionOptions)
              .then(rev => {
                revision = rev;
              })
              .then(finishTransaction)
              .catch(rollbackTransaction);
          });
          it('should set revisionValidFrom automatically', () => {
            expect(revision).to.have.property('revisionValidFrom');
            expect(revision.revisionValidFrom).to.be.an.instanceof(Date);
          });
          it('should set revisionValidTo to null', () => {
            expect(revision).to.have.property('revisionValidTo');
            expect(revision.revisionValidTo).to.equal.null;
          });
        });
        context('that is a second revision', () => {
          let firstRevision, secondRevision;
          beforeEach(() => {
            const data = _.merge({}, modelValues);
            return RevisionModel.create(data, transactionOptions)
              .then(rev => {
                firstRevision = rev;
                return RevisionModel.create(data, transactionOptions);
              })
              .then(() => {
                return firstRevision.reload(transactionOptions);
              })
              .then(rev => {
                secondRevision = rev;
              })
              .then(finishTransaction)
              .catch(rollbackTransaction);
          });
          it('should set revisionValidFrom automatically', () => {
            expect(firstRevision).to.have.property('revisionValidFrom');
            expect(firstRevision.revisionValidFrom).to.be.an.instanceof(Date);
            expect(secondRevision).to.have.property('revisionValidFrom');
            expect(secondRevision.revisionValidFrom).to.be.an.instanceof(Date);
          });
          it('should set revisionValidTo on the first instance', () => {
            expect(firstRevision).to.have.property('revisionValidTo');
            expect(firstRevision.revisionValidTo).to.be.an.instanceof(Date);
          });
          it('should set revisionValidTo to null on the second instance', () => {
            expect(secondRevision).to.have.property('revisionValidTo');
            expect(secondRevision.revisionValidTo).to.equal.null;
          });
        });
        describe('that is a later revision', () => {
          it('should only update revisionValidTo once', () => {
            let firstRevision, secondRevision, thirdRevision;
            let originalDate;
            const data = _.merge({}, modelValues);
            return RevisionModel.create(data, transactionOptions)
              .then(rev => {
                firstRevision = rev;
                return RevisionModel.create(data, transactionOptions);
              })
              .then(() => {
                return firstRevision.reload(transactionOptions);
              })
              .then(rev => {
                originalDate = rev.revisionValidTo;
                secondRevision = rev;
                return RevisionModel.create(data, transactionOptions);
              })
              .then(rev => {
                thirdRevision = rev;
                return firstRevision.reload(transactionOptions);
              })
              .then(rev => {
                expect(originalDate.valueOf()).to.equal(
                  rev.revisionValidTo.valueOf()
                );
              })
              .then(finishTransaction)
              .catch(rollbackTransaction);
          });
        });
      });
      describe('the original model', () => {
        beforeEach(() => {
          RevisionModel = trackRevisions(Model);
          return temporaryDB.sync(transactionOptions);
        });
        context('when a new instance is created', () => {
          let instance;
          beforeEach(() => {
            return Model.create({}, transactionOptions).then(item => {
              instance = item;
              return instance;
            });
          });
          it('should create a new revision', () => {
            return RevisionModel.count({
              where: {
                id: instance.id,
              },
              transaction: transaction,
            })
              .then(count => {
                expect(count).to.equal(1);
              })
              .then(finishTransaction)
              .catch(rollbackTransaction);
          });
        });
        context('when a existing instance is updated', () => {
          let instance;
          beforeEach(() => {
            return Model.create({}, transactionOptions).then(item => {
              instance = item;
              return instance.update({ name: 'asdf' }, transactionOptions);
            });
          });
          it('should create a new revision', () => {
            return RevisionModel.count({
              where: {
                id: instance.id,
              },
              transaction: transaction,
            })
              .then(count => {
                expect(count).to.equal(2);
              })
              .then(finishTransaction)
              .catch(rollbackTransaction);
          });
          it('should update the revisionValidTo update on the original revision', () => {
            return RevisionModel.findAll({
              where: {
                id: instance.id,
              },
              transaction: transaction,
            })
              .then(revisions => {
                expect(revisions[0].revisionValidTo).to.be.defined;
                expect(revisions[1].revisionValidTo).to.be.null;
              })
              .then(finishTransaction)
              .catch(rollbackTransaction);
          });
        });
        context(
          'when a existing instance is updated but nothing changes',
          () => {
            let instance;
            beforeEach(() => {
              return Model.create({}, transactionOptions).then(item => {
                instance = item;
                return instance.update(item.dataValues, transactionOptions);
              });
            });
            it('should not create a new revision', () => {
              return RevisionModel.count({
                where: {
                  id: instance.id,
                },
                transaction: transaction,
              })
                .then(count => {
                  expect(count).to.equal(1);
                })
                .then(finishTransaction)
                .catch(rollbackTransaction);
            });
          }
        );
        context('when a existing instance is deleted', () => {
          let instance;
          beforeEach(() => {
            return Model.create({}, transactionOptions).then(item => {
              instance = item;
              return instance.destroy(transactionOptions);
            });
          });
          it('should not create a new revision', () => {
            return RevisionModel.count({
              where: {
                id: instance.id,
              },
              transaction: transaction,
            })
              .then(count => {
                expect(count).to.equal(1);
              })
              .then(finishTransaction)
              .catch(rollbackTransaction);
          });
          it('should make the latest revision invalid', () => {
            return RevisionModel.find({
              where: {
                id: instance.id,
              },
              transaction: transaction,
            })
              .then(revision => {
                expect(revision.revisionValidTo).to.be.defined;
              })
              .then(finishTransaction)
              .catch(rollbackTransaction);
          });
        });
      });
    });
  });
  context('when not using transactions', () => {
    it('should not accept invalid models', () => {
      expect(() => {
        trackRevisions(10);
      }).to.throw(Error);
      expect(() => {
        trackRevisions({});
      }).to.throw(Error);
    });

    context('when given a model', () => {
      describe('the generated revisions model', () => {
        beforeEach(() => {
          return Model.bulkCreate([
            { id: '123', name: 'item1' },
            { id: '124', name: 'item2' },
          ]);
        });
        beforeEach(() => {
          RevisionModel = trackRevisions(Model);
          return temporaryDB.sync();
        });

        it('should make name $tableName + _revision', () => {
          expect(RevisionModel.name).to.equal(
            Model.options.name.singular + '_revision'
          );
        });
        it('should add revisionId, revisionFrom, and revisionTo to the model', () => {
          expect(RevisionModel.attributes.revisionId).to.be.defined;
          expect(RevisionModel.attributes.revisionValidFrom).to.be.defined;
          expect(RevisionModel.attributes.revisionValidTo).to.be.defined;
        });
        it('should copy all the original fields into the revisions Table', () => {
          const originalKeys = _.omit(Model.attributes, [
            'updatedAt',
            'createdAt',
            'deletedAt',
          ]);
          expect(RevisionModel.attributes).to.contain.all.keys(originalKeys);
        });
        it('should strip primaryKey, unique, references, onDelete, onUpdate, autoIncrement attributes', () => {
          const dynamicAttributes = _.values(
            _.omit(RevisionModel.attributes, [
              'revisionId',
              'revisionValidFrom',
              'revisionValidTo',
            ])
          );

          const primaryKeys = _.without(
            _.map(dynamicAttributes, 'primaryKey'),
            undefined
          );
          const uniques = _.without(
            _.map(dynamicAttributes, 'unique'),
            undefined
          );
          const referenceses = _.without(
            _.map(dynamicAttributes, 'references'),
            undefined
          );
          const onDeletes = _.without(
            _.map(dynamicAttributes, 'onDelete'),
            undefined
          );
          const onUpdates = _.without(
            _.map(dynamicAttributes, 'onUpdate'),
            undefined
          );
          const autoIncrements = _.without(
            _.map(dynamicAttributes, 'autoIncrement'),
            undefined
          );

          expect(primaryKeys.length).to.equal(0);
          expect(uniques.length).to.equal(0);
          expect(referenceses.length).to.equal(0);
          expect(onDeletes.length).to.equal(0);
          expect(onUpdates.length).to.equal(0);
          expect(autoIncrements.length).to.equal(0);
        });
      });
      describe('a generated revisions instance', () => {
        let modelValues, promise;
        beforeEach(() => {
          RevisionModel = trackRevisions(Model);
          return temporaryDB.sync();
        });
        beforeEach(() => {
          return Model.create({}).then(item => {
            modelValues = item.dataValues;
          });
        });
        it('should not allow revisionValidFrom to be set manually', () => {
          const data = _.merge({}, modelValues, {
            revisionValidFrom: new Date(),
          });
          promise = RevisionModel.create(data);
          expect(promise).to.eventually.be.rejectedWith(
            'revisionValidFrom cannot be set manually'
          );
        });
        it('should not allow revisionValidTo to be set manually', () => {
          const data = _.merge({}, modelValues, {
            revisionValidTo: new Date(),
          });
          promise = RevisionModel.create(data);
          expect(promise).to.eventually.be.rejectedWith(
            'revisionValidTo cannot be set manually'
          );
        });
        it('should not allow updating model fields', () => {
          const data = _.merge({}, modelValues, {});
          promise = RevisionModel.create(data).then(revision => {
            return revision.update({ name: 'name' });
          });
          expect(promise).to.eventually.be.rejected;
        });
        it('should not allow deleting', () => {
          const data = _.merge({}, modelValues, {});
          promise = RevisionModel.create(data).then(revision => {
            return revision.destroy();
          });
          expect(promise).to.eventually.be.rejected;
        });
        context('that is the first revision', () => {
          let revision;
          beforeEach(() => {
            const data = _.merge({}, modelValues);
            return RevisionModel.create(data).then(rev => {
              revision = rev;
            });
          });
          it('should set revisionValidFrom automatically', () => {
            expect(revision).to.have.property('revisionValidFrom');
            expect(revision.revisionValidFrom).to.be.an.instanceof(Date);
          });
          it('should set revisionValidTo to null', () => {
            expect(revision).to.have.property('revisionValidTo');
            expect(revision.revisionValidTo).to.equal.null;
          });
        });
        context('that is a second revision', () => {
          let firstRevision, secondRevision;
          beforeEach(() => {
            const data = _.merge({}, modelValues);
            return RevisionModel.create(data)
              .then(rev => {
                firstRevision = rev;
                return RevisionModel.create(data);
              })
              .then(() => {
                return firstRevision.reload();
              })
              .then(rev => {
                secondRevision = rev;
              });
          });
          it('should set revisionValidFrom automatically', () => {
            expect(firstRevision).to.have.property('revisionValidFrom');
            expect(firstRevision.revisionValidFrom).to.be.an.instanceof(Date);
            expect(secondRevision).to.have.property('revisionValidFrom');
            expect(secondRevision.revisionValidFrom).to.be.an.instanceof(Date);
          });
          it('should set revisionValidTo on the first instance', () => {
            expect(firstRevision).to.have.property('revisionValidTo');
            expect(firstRevision.revisionValidTo).to.be.an.instanceof(Date);
          });
          it('should set revisionValidTo to null on the second instance', () => {
            expect(secondRevision).to.have.property('revisionValidTo');
            expect(secondRevision.revisionValidTo).to.equal.null;
          });
        });
        describe('that is a later revision', () => {
          it('should only update revisionValidTo once', () => {
            let firstRevision, secondRevision, thirdRevision;
            let originalDate;
            const data = _.merge({}, modelValues);
            return RevisionModel.create(data)
              .then(rev => {
                firstRevision = rev;
                return RevisionModel.create(data);
              })
              .then(() => {
                return firstRevision.reload();
              })
              .then(rev => {
                originalDate = rev.revisionValidTo;
                secondRevision = rev;
                return RevisionModel.create(data);
              })
              .then(rev => {
                thirdRevision = rev;
                return firstRevision.reload();
              })
              .then(rev => {
                expect(originalDate.valueOf()).to.equal(
                  rev.revisionValidTo.valueOf()
                );
              });
          });
        });
      });
      describe('the original model', () => {
        beforeEach(() => {
          RevisionModel = trackRevisions(Model);
          return temporaryDB.sync();
        });
        context('when a new instance is created', () => {
          let instance;
          beforeEach(() => {
            return Model.create({}).then(item => {
              instance = item;
              return instance;
            });
          });
          it('should create a new revision', () => {
            return RevisionModel.count({
              where: {
                id: instance.id,
              },
            }).then(count => {
              expect(count).to.equal(1);
            });
          });
        });
        context('when a existing instance is updated', () => {
          let instance;
          beforeEach(() => {
            return Model.create({}).then(item => {
              instance = item;
              return instance.update({ name: 'asdf' });
            });
          });
          it('should create a new revision', () => {
            return RevisionModel.count({
              where: {
                id: instance.id,
              },
            }).then(count => {
              expect(count).to.equal(2);
            });
          });
          it('should update the revisionValidTo update on the original revision', () => {
            return RevisionModel.findAll({
              where: {
                id: instance.id,
              },
            }).then(revisions => {
              expect(revisions[0].revisionValidTo).to.be.defined;
              expect(revisions[1].revisionValidTo).to.be.null;
            });
          });
        });
        context(
          'when a existing instance is updated but nothing changes',
          () => {
            let instance;
            beforeEach(() => {
              return Model.create({}).then(item => {
                instance = item;
                return instance.update(item.dataValues);
              });
            });
            it('should not create a new revision', () => {
              return RevisionModel.count({
                where: {
                  id: instance.id,
                },
              }).then(count => {
                expect(count).to.equal(1);
              });
            });
          }
        );
        context('when a existing instance is deleted', () => {
          let instance;
          beforeEach(() => {
            return Model.create({}).then(item => {
              instance = item;
              return instance.destroy();
            });
          });
          it('should not create a new revision', () => {
            return RevisionModel.count({
              where: {
                id: instance.id,
              },
            }).then(count => {
              expect(count).to.equal(1);
            });
          });
          it('should make the latest revision invalid', () => {
            return RevisionModel.find({
              where: {
                id: instance.id,
              },
            }).then(revision => {
              expect(revision.revisionValidTo).to.be.defined;
            });
          });
        });
      });
    });
  });
  describe('whoDunnit', () => {
    context('with a valid username on the session', () => {
      let instance;
      beforeEach(() => {
        return createFakeDB().then(fakeDB => {
          fakeDB.whoDunnit = 'waldo';
          temporaryDB = fakeDB;
          Model = fakeDB.define('TestModel', {
            name: Sequelize.STRING,
          });
        });
      });
      beforeEach(() => {
        RevisionModel = trackRevisions(Model);
        return temporaryDB.sync();
      });
      beforeEach(() => {
        return Model.create({}).then(inst => {
          instance = inst;
        });
      });
      it('should be set', () => {
        return RevisionModel.find({
          where: {
            id: instance.id,
          },
        }).then(revision => {
          expect(revision).to.have.property('whoDunnit');
          expect(revision.whoDunnit).to.equal('waldo');
        });
      });
    });
    context('without a valid username on the session', () => {
      let instance;
      beforeEach(() => {
        return createFakeDB().then(fakeDB => {
          temporaryDB = fakeDB;
          Model = fakeDB.define('TestModel', {
            name: Sequelize.STRING,
          });
        });
      });
      beforeEach(() => {
        RevisionModel = trackRevisions(Model);
        return temporaryDB.sync();
      });
      beforeEach(() => {
        return Model.create({}).then(inst => {
          instance = inst;
        });
      });
      it('should be set to the process.env.NODE_ENV', () => {
        return RevisionModel.find({
          where: {
            id: instance.id,
          },
        }).then(revision => {
          expect(revision).to.have.property('whoDunnit');
          expect(revision.whoDunnit).to.contain(process.env.NODE_ENV);
        });
      });
    });
  });
});
