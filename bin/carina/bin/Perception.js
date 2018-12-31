var async = require("async");
var bcpu = require("../lib/temp/Bcpu");
var CompounddWord = require("../lib/models/CompoundWordsSchema");
var { domain } = require("./Domain");
var Belief = require("../lib/models/Belief");
var _ = require("lodash");

class Perception {
  postCognitiveModel(collection) {
    let dominio = {
      name: collection.contexto.nombre,
      type: `@${collection.contexto.nombre.replace(" ", "_").toUpperCase()}`
    };
    domain.saveDomain(dominio);

    let contexto = collection.contexto;
    let palabrasClave = contexto.palabrasClave;
    let registros = collection.registros;

    async.eachSeries(
      registros,
      (registro, cbReg) => {
        async.autoInject(
          {
            eEFD: callback => {
              domain.extractEntityFromDomain(callback, registro);
            },
            cEOR: (eEFD, callback) => {
              domain.consolidateEntitiesFromRegister(callback, collection);
            },
            aTD: (cEOR, callback) => {
              domain.addToDomain(callback, dominio, registro);
            },
            pEOQ: (aTD, callback) => {
              domain.processElaborationOfQuestions(
                callback,
                registro,
                dominio.type
              );
            }
          },
          (err, results) => {
            cbReg(null, registro);
          }
        );
      },
      err => {
        if (this.socket != undefined)
          this.socket.emit("returnDataWithKeyWords", collection);
        console.log(JSON.stringify(collection, null, 2));
      }
    );
  }

  relationedWords(body) {
    let dominio = `@${body.contexto.nombre.replace(" ", "_").toUpperCase()}`;
    body.contexto.type = dominio;
    let relaciones = body.relaciones;
    let preguntasGeneradas = {
      type: body.contexto.type,
      preguntas: body.contexto.preguntasGeneradas
    };
    async.eachSeries(
      relaciones,
      (relacion, cbRel) => {
        if (relacion.palabraClave != null && relacion.active) {
          this.relationedDomainWithKeyword(dominio, relacion.palabraClave);
          let temasDeInteres = relacion.temasDeInteres;
          this.searchInBelief(
            cbRel,
            temasDeInteres,
            relacion //,
            //preguntasGeneradas
          );
        } else {
          cbRel();
        }
      },
      err => {
        if (err) throw err;
        //console.log(JSON.stringify(relaciones, null, 2));
      }
    );
  }

  searchInBelief(cbRel, temas, relacion /*, preguntasGeneradas*/) {
    let arrTemInt = [];
    async.eachSeries(
      temas,
      (tema, cbTem) => {
        Belief.find({ name: tema.temaDeInteres })
          .select("_id")
          .exec((err, t) => {
            if (t.length > 0) {
              Belief.update(
                { name: relacion.palabraClave },
                { $addToSet: { "attributes.holonym": t[0]._id } }
              ).exec(err => {
                Belief.find({ name: relacion.palabraClave }).exec((err, kw) => {
                  Belief.update(
                    { _id: kw[0]._id },
                    {
                      $addToSet: {
                        "attributes.meronym": t[0]._id
                      }
                    }
                  ).exec((err, a) => {
                    if (err) throw err;
                  });
                });

                arrTemInt.push(t[0]._id);
                cbTem();
              });
            } else {
              cbTem();
            }
          });
      },
      err => {
        let i = 0;
        async.eachSeries(
          temas,
          (stema, cbsTem) => {
            Belief.find({ name: { $in: stema.palabrasRelevantes } })
              .select("_id")
              .exec((err, t) => {
                let ids = t.map(i => i._id);
                if (t.length > 0) {
                  Belief.update(
                    { _id: arrTemInt[i] },
                    { $addToSet: { "attributes.holonym": { $each: ids } } }
                  ).exec((err, r) => {
                    Belief.update(
                      { _id: { $in: ids } },
                      { multi: true },
                      {
                        $addToSet: {
                          "attributes.meronym": { $each: arrTemInt[i] }
                        }
                      }
                    ).exec((err, result) => {
                      if (err) throw err;
                    });
                    i++;
                    cbsTem();
                  });
                } else {
                  cbsTem();
                }
              });
          },
          err => {
            //domain.getPalabrasClaves(cbRel, preguntasGeneradas);
          }
        );
      }
    );
  }

  relationedDomainWithKeyword(dominio, keyword) {
    Belief.find({ name: keyword }).exec((err, kId) => {
      if (kId.length != 0)
        Belief.update(
          { name: dominio },
          { $addToSet: { "attributes.holonym": kId[0]._id } }
        ).exec((err, r) => {
          if (err) throw err;
        });
    });
  }
}

exports.perception = new Perception();
