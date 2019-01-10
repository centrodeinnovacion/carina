var async = require("async");
var _ = require("lodash");
var { date } = require("./Date");
var DomainSh = require("../lib/models/Domain");
var Belief = require("../lib/models/Belief");
var ObjectId = require("mongodb").ObjectID;

class Domain {
  constructor() {
    this.questionWords = [
      {
        eP: ["qué", "quién", "que", "quien"],
        eR: ["organizaciones"]
      },
      {
        eP: ["quién", "quien"],
        eR: ["personas"]
      },
      {
        eP: ["dónde", "donde"],
        eR: ["lugares"]
      },
      {
        eP: ["dónde", "donde"],
        eR: ["miscelaneas"]
      },
      {
        eP: ["cuándo", "cuando"],
        eR: ["fechas"]
      }
    ];
  }
  extractEntityFromDomain(cbEEFD, reg) {
    let res = reg.respuesta;
    let sol = reg.solicitud;

    async.autoInject(
      {
        //get entityt respuesta from domain
        gERFD: cb => {
          let d = [
            //{ type: "@DEPENDENCIES", path: "dependencias" },
            { type: "@PLACES", path: "lugares" },
            { type: "@OWN_NAMES_SURNAMES", path: "personas" },
            { type: "@INTERROGATIVE_SENTENCES", path: "preguntas" },
            { type: "@DATE", path: "fechas" }
          ];
          console.time("gERFD");
          this.getEntityFromDomains(cb, reg, res, "entidadesRespuesta", d);
        },
        //remove entity from result
        rEFRR: (gERFD, cb) => {
          console.timeEnd("gERFD");
          console.time("rEFRR");
          this.removeEntityFromResult(cb, gERFD, {
            entidad: "entidadesRespuesta",
            path: "miscelaneas"
          });
        },
        //get entityt solicitud from domain
        gESFD: (rEFRR, cb) => {
          console.timeEnd("rEFRR");
          console.time("gESFD");
          let d = [
            //{ type: "@DEPENDENCIES", path: "dependencias" },
            { type: "@PLACES", path: "lugares" },
            { type: "@OWN_NAMES_SURNAMES", path: "personas" },
            { type: "@INTERROGATIVE_SENTENCES", path: "preguntas" },
            { type: "@DATE", path: "fechas" },
            { type: "@VERBS", path: "verbosSolcitudes" }
            //{ type: "@CONJUGATED_VERBS", path: "verbos" }
          ];

          console.time("getEntityFromDomains2");

          _.set(
            reg,
            "entidadesRespuesta.organizaciones",
            reg.dependencia.split(".")
          );
          _.set(
            reg,
            "entidadesRespuesta.dependencias",
            reg.dependencia.split(".")
          );

          this.getEntityFromDomains(cb, reg, sol, "entidadesSolicitud", d);
        },
        //remove entity from result
        rEFRS: (gESFD, cb) => {
          console.timeEnd("gESFD");
          console.time("rEFRS");
          this.removeEntityFromResult(cb, gESFD, {
            entidad: "entidadesSolicitud",
            path: "miscelaneas"
          });
        }
      },
      (err, result) => {
        console.timeEnd("rEFRS");
        cbEEFD(null, result);
      }
    );
  }

  removeEntityFromResult(cb, gERFD, domain) {
    let e = gERFD[domain.entidad];
    let eSol = _.compact(
      _.concat(e.fechas, e.dependencias, e.lugares, e.preguntas)
    );

    let entidad =
      domain.entidad == "entidadesRespuesta"
        ? gERFD.respuesta
        : gERFD.solicitud;

    eSol.map(w => (entidad = _.replace(entidad, w, "")));
    this.remStopWords(cb, entidad, gERFD, domain);
  }

  remStopWords(cb, source, gERFD, domain) {
    let elements = [];
    DomainSh.find({
      type: {
        $in: [
          "@STOP_WORDS",
          "@GREETINGS",
          "@FAREWELLS",
          "@VERBS",
          "@ADVERBS_OF_TIME",
          "@ADVERBS_OF_PLACE",
          "@POSSESSIVE_ADJETIVES"
          //"@CONJUGATED_VERBS"
        ]
      }
    })
      .populate("elements", "name -_id")
      .exec((err, d) => {
        if (d.length != 0) {
          let arrKeyWords = [];
          d.map(o => {
            o.elements.map(e => arrKeyWords.push(e));
          });

          source
            .toLowerCase()
            .split(" ")
            .forEach(w => {
              if (!_.some(arrKeyWords, { name: w })) {
                elements.push(w);
              }
            });

          _.set(gERFD, `${domain.entidad}.${domain.path}`, _.compact(elements));
          cb(null, gERFD);
        }
      });
  }

  getEntityFromDomains(callback, registro, source, entidad, domains) {
    async.eachSeries(
      domains,
      (domain, cbDom) => {
        if (domain.type != "@DATE") {
          DomainSh.find({ type: domain.type })
            .populate("elements", "name -_id")
            .exec((err, d) => {
              let elements = [];
              let removeWords = [];

              if (d.length != 0) {
                source.split(" ").forEach(w => {
                  if (_.some(d[0].elements, { name: w })) {
                    elements.push(w);
                  } else removeWords.push(w);
                });

                _.set(registro, `${entidad}.${domain.path}`, elements);
                _.set(registro, `palabrasDescartadas`, removeWords);
                cbDom(null);
              } else {
                cbDom(null);
              }
            });
        } else {
          _.set(registro, `${entidad}.${domain.path}`, date.getDate(source));
          cbDom(null);
        }
      },
      err => {
        callback(null, registro);
      }
    );
  }

  consolidateEntitiesFromRegister(callback, collection) {
    let contexto = collection.contexto;
    let entidades = collection.entidades;
    let registros = collection.registros;

    let arrDep = [];
    let arrPalDesc = [];
    let arrPalCan = [];
    let arrEntLugares = [];
    let arrEntFechas = [];
    let arrEntDependencias = [];
    let arrEntOrganizaciones = [];
    let arrEntPersonas = [];
    let arrEntMiscelaneas = [];
    let arrEntPreguntas = [];
    let arrEntVerbosDelDominio = [];
    let arrPreguntasGeneradas = [];

    registros.forEach(registro => {
      registro.dependencia
        .toLowerCase()
        .split(".")
        .forEach(element => {
          arrDep.push(element.trim());
        });
    });

    registros.forEach(registro => {
      arrEntFechas = _.compact(
        _.concat(
          registro.entidadesSolicitud.fechas,
          registro.entidadesRespuesta.fechas
        )
      );

      if (registro.preguntasGeneradas != undefined)
        arrPreguntasGeneradas.push(registro.preguntasGeneradas);

      arrEntLugares = _.compact(
        _.concat(
          registro.entidadesSolicitud.lugares,
          registro.entidadesRespuesta.lugares
        )
      );

      arrEntDependencias = _.compact(
        _.concat(
          registro.entidadesSolicitud.dependencias,
          registro.entidadesRespuesta.dependencias
        )
      );

      arrEntOrganizaciones = _.compact(
        _.concat(
          registro.entidadesSolicitud.organizaciones,
          registro.entidadesRespuesta.organizaciones
        )
      );

      arrEntPersonas = _.compact(
        _.concat(
          registro.entidadesSolicitud.personas,
          registro.entidadesRespuesta.personas
        )
      );

      arrEntMiscelaneas = _.compact(
        _.concat(
          registro.entidadesSolicitud.miscelaneas,
          registro.entidadesRespuesta.miscelaneas
        )
      );

      arrEntPreguntas = _.compact(
        _.concat(
          registro.entidadesSolicitud.preguntas,
          registro.entidadesRespuesta.preguntas
        )
      );

      arrEntVerbosDelDominio = _.compact(
        _.concat(
          registro.entidadesSolicitud.verbos,
          registro.entidadesRespuesta.verbos
        )
      );

      arrPalDesc = registro.palabrasDescartadas;
    });

    arrPalCan = _.compact(
      _.concat(
        arrEntDependencias,
        arrEntLugares,
        arrEntFechas,
        arrEntOrganizaciones,
        arrEntPersonas,
        arrEntMiscelaneas,
        arrEntPreguntas,
        arrEntVerbosDelDominio
      )
    );

    //compilation
    contexto.dependencias = _.uniq(arrDep, e => e);
    contexto.palabrasDescartadas = _.uniq(arrPalDesc, e => e);
    contexto.palabrasRelevantes = _.uniq(arrPalCan, e => e);
    contexto.palabrasCandidatas = _.uniq(arrPalCan, e => e);
    contexto.dependencias = _.uniq(arrEntDependencias, e => e);
    contexto.preguntasGeneradas = _.uniq(arrPreguntasGeneradas, e => e);
    entidades.lugares = _.uniq(arrEntLugares, e => e);
    entidades.Fechas = _.uniq(arrEntFechas, e => e);
    entidades.organizaciones = _.uniq(arrEntDependencias, e => e);
    entidades.personas = _.uniq(arrEntPersonas, e => e);
    entidades.miscelaneas = _.uniq(arrEntMiscelaneas, e => e);
    entidades.preguntas = _.uniq(arrEntPreguntas, e => e);
    entidades.verbosDelDominio = _.uniq(arrEntVerbosDelDominio, e => e);

    callback(null, collection);
  }

  saveDomain(domain) {
    DomainSh.find({ type: domain.type }).exec((err, d) => {
      if (d.length == 0) {
        let nDomain = new DomainSh(domain);

        nDomain.save(function(err) {
          if (err) return handleError(err);
        });

        Belief.find({ name: domain.type }).exec((err, b) => {
          if (b.length == 0) Belief.create({ name: domain.type });
        });
      } else {
        console.log("El nombre del dominio ya existe");
      }
    });
  }

  addToDomain(cbTD, domain, registro) {
    let arrObj = [];
    registro.dependencia.split(".").forEach(element => {
      arrObj.push({ _id: new ObjectId(), name: element.toLowerCase().trim() });
    });

    async.eachSeries(
      arrObj,
      (obj, cbObj) => {
        Belief.find({ name: obj.name }).exec((err, f) => {
          let id;
          if (f.length == 0) {
            Belief.create(obj);
            id = obj._id;
          } else {
            id = f[0]._id;
          }

          DomainSh.update(
            { type: domain.type },
            { $addToSet: { elements: id } }
          ).exec((err, r) => {
            if (err) throw err;
            cbObj();
          });
        });
      },
      err => {
        cbTD();
      }
    );
  }
  processElaborationOfQuestions(callback, registro, dominio) {
    let preguntasGeneradas = [];

    if (
      registro.entidadesSolicitud.preguntas != undefined &&
      registro.entidadesSolicitud.preguntas.length != 0
    ) {
      //registro.entidadesSolicitud.preguntas.forEach(pregunta => {
      async.eachSeries(
        registro.entidadesSolicitud.preguntas,
        (pregunta, cbPreg) => {
          //this.questionWords.forEach(qw => {
          async.eachSeries(this.questionWords, (qw, cbQW) => {
            let objQ = {};
            if (
              _.findIndex(qw.eP, function(o) {
                return o == pregunta;
              }) > 0
            ) {
              let iLM = registro.entidadesSolicitud.miscelaneas.length - 1;
              let lastMisc = registro.entidadesSolicitud.miscelaneas[iLM];
              let pMisc = registro.solicitud.indexOf(lastMisc);
              let pPreg = registro.solicitud.indexOf(pregunta);
              let preg = registro.solicitud.substring(
                pPreg,
                pMisc + lastMisc.length
              );

              let resp = registro.entidadesRespuesta[qw.eR][0];
              let palRel = registro.entidadesSolicitud.miscelaneas;

              if (preg != undefined && resp != undefined) {
                _.set(objQ, "pregunta", preg);
                _.set(objQ, "respuesta", resp);
                _.set(objQ, "palabrasRelevantes", palRel);
                _.set(objQ, "seleccionado", true);
              }
              _.set(registro, "preguntasGeneradas", objQ);
              cbQW();
            } else {
              cbQW();
            }
          });
          cbPreg();
        }
      );
    }
    callback();
  }

  getPalabrasClaves(cbRel, palRel) {
    //recorrer palabras y hacer population por grupos
    let type = palRel.type;
    let preguntas = palRel.preguntas;
    async.eachSeries(
      preguntas,
      (pregunta, cbPreg) => {
        Belief.find({ name: { $in: pregunta.palabrasRelevantes } })
          .populate({
            path: "attributes.meronym",
            model: "Belief",
            populate: {
              path: "attributes.meronym",
              model: "Belief",
              populate: {
                path: "attributes.meronym",
                model: "Belief",
                select: "name -_id"
                //match: { name: { $in: lema } }
              }
            }
          })
          .exec((err, d) => {
            console.log(JSON.stringify(d, null, 2));
            //_.set(objQ, "palabrasClave", palClav);
          });
      },
      err => {
        cbRel();
      }
    );
  }
}

exports.domain = new Domain();
