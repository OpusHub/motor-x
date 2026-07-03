// JSON Schemas dos outputs dos agentes (structured outputs — JSON garantido).

const FATO = {
  type: "object",
  properties: {
    texto: { type: "string" },
    fonte: { type: "string" },
    origem: { type: "string", enum: ["inbox", "trend", "banco"] },
  },
  required: ["texto", "fonte", "origem"],
  additionalProperties: false,
} as const;

export const PAUTAS_SCHEMA = {
  type: "object",
  properties: {
    pautas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          pilar: { type: "integer", enum: [1, 2, 3, 4, 5] },
          objetivo: {
            type: "string",
            enum: ["alcance", "bookmark", "prova", "seguidor", "momento", "produto", "oferta"],
          },
          mov: { type: "string" },
          idioma: { type: "string", enum: ["pt", "en"] },
          fato: FATO,
          angulo: { type: "string" },
          inbox_media_id: { type: ["string", "null"] },
        },
        required: ["id", "pilar", "objetivo", "mov", "idioma", "fato", "angulo", "inbox_media_id"],
        additionalProperties: false,
      },
    },
  },
  required: ["pautas"],
  additionalProperties: false,
};

export const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    texto: { type: "string" },
    seed_descartada: { type: "string" },
    autocheck: {
      type: "object",
      properties: {
        fato_da_pauta: { type: "boolean" },
        sem_travessao: { type: "boolean" },
        idioma_unico: { type: "boolean" },
      },
      required: ["fato_da_pauta", "sem_travessao", "idioma_unico"],
      additionalProperties: false,
    },
  },
  required: ["texto", "seed_descartada", "autocheck"],
  additionalProperties: false,
};

export const CRITICO_SCHEMA = {
  type: "object",
  properties: {
    finalistas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          texto: { type: "string" },
          score: { type: "integer" },
          mudancas: { type: "string" },
        },
        required: ["id", "texto", "score", "mudancas"],
        additionalProperties: false,
      },
    },
    mortos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          motivo: { type: "string" },
        },
        required: ["id", "motivo"],
        additionalProperties: false,
      },
    },
  },
  required: ["finalistas", "mortos"],
  additionalProperties: false,
};

export const EDITOR_SCHEMA = {
  type: "object",
  properties: {
    selecionados: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          rank: { type: "integer" },
          janela: { type: "string", enum: ["almoco", "tarde"] },
          motivo: { type: "string" },
        },
        required: ["id", "rank", "janela", "motivo"],
        additionalProperties: false,
      },
    },
    descartados: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          motivo: { type: "string" },
        },
        required: ["id", "motivo"],
        additionalProperties: false,
      },
    },
  },
  required: ["selecionados", "descartados"],
  additionalProperties: false,
};
