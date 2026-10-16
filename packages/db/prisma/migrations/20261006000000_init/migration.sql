-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CanalTipo" AS ENUM ('MERCADO_LIVRE', 'SHOPEE', 'AMAZON', 'MAGALU', 'LOJA_PROPRIA', 'OUTRO');

-- CreateEnum
CREATE TYPE "TipoTaxa" AS ENUM ('COMISSAO', 'FRETE', 'TARIFA_FIXA', 'ANTECIPACAO', 'OUTRA');

-- CreateEnum
CREATE TYPE "OrigemTaxa" AS ENUM ('REAL', 'ESTIMADO');

-- CreateEnum
CREATE TYPE "StatusWebhook" AS ENUM ('PENDENTE', 'PROCESSADO', 'ERRO', 'IGNORADO');

-- CreateEnum
CREATE TYPE "StatusSync" AS ENUM ('OCIOSO', 'RODANDO', 'ERRO');

-- CreateEnum
CREATE TYPE "PapelUsuario" AS ENUM ('ADMIN', 'GESTOR', 'OPERADOR');

-- CreateTable
CREATE TABLE "empresa" (
    "id" SERIAL NOT NULL,
    "bling_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_token" (
    "id" SERIAL NOT NULL,
    "empresa_id" INTEGER NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "token_type" TEXT NOT NULL DEFAULT 'Bearer',
    "scope" TEXT,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "refresh_expira_em" TIMESTAMP(3) NOT NULL,
    "ultimo_refresh_em" TIMESTAMP(3),
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canal" (
    "id" SERIAL NOT NULL,
    "empresa_id" INTEGER NOT NULL,
    "bling_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "CanalTipo" NOT NULL DEFAULT 'OUTRO',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produto" (
    "id" SERIAL NOT NULL,
    "empresa_id" INTEGER NOT NULL,
    "bling_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "gtin" TEXT,
    "unidade" TEXT,
    "peso_kg" DECIMAL(10,4),
    "aliquota_imposto" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "raw" JSONB,
    "sincronizado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produto_custo" (
    "id" SERIAL NOT NULL,
    "produto_id" INTEGER NOT NULL,
    "custo" DECIMAL(14,4) NOT NULL,
    "preco_compra" DECIMAL(14,4),
    "vigencia_inicio" TIMESTAMP(3) NOT NULL,
    "vigencia_fim" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "produto_custo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido" (
    "id" SERIAL NOT NULL,
    "empresa_id" INTEGER NOT NULL,
    "bling_id" TEXT NOT NULL,
    "numero" TEXT,
    "numero_loja" TEXT,
    "canal_id" INTEGER,
    "data" TIMESTAMP(3) NOT NULL,
    "data_saida" TIMESTAMP(3),
    "situacao_id" INTEGER,
    "situacao_nome" TEXT,
    "considerar_na_analise" BOOLEAN NOT NULL DEFAULT true,
    "total_produtos" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "total_pedido" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "desconto" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "frete_cliente" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "frete_vendedor" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "contato_nome" TEXT,
    "contato_doc" TEXT,
    "raw" JSONB,
    "sincronizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "versao_evento" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido_item" (
    "id" SERIAL NOT NULL,
    "pedido_id" INTEGER NOT NULL,
    "produto_id" INTEGER,
    "sku" TEXT,
    "descricao" TEXT,
    "quantidade" DECIMAL(14,4) NOT NULL,
    "valor_unitario" DECIMAL(14,4) NOT NULL,
    "desconto" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "custo_unitario" DECIMAL(14,4),

    CONSTRAINT "pedido_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido_taxa" (
    "id" SERIAL NOT NULL,
    "pedido_id" INTEGER NOT NULL,
    "tipo" "TipoTaxa" NOT NULL,
    "origem" "OrigemTaxa" NOT NULL,
    "valor" DECIMAL(14,4) NOT NULL,
    "descricao" TEXT,

    CONSTRAINT "pedido_taxa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regra_taxa" (
    "id" SERIAL NOT NULL,
    "canal_id" INTEGER NOT NULL,
    "descricao" TEXT NOT NULL,
    "percentual" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "taxa_fixa" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "valor_minimo" DECIMAL(14,4),
    "valor_maximo" DECIMAL(14,4),
    "sku" TEXT,
    "vigencia_inicio" TIMESTAMP(3) NOT NULL,
    "vigencia_fim" TIMESTAMP(3),
    "prioridade" INTEGER NOT NULL DEFAULT 0,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regra_taxa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_event" (
    "id" SERIAL NOT NULL,
    "event_id" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "company_id" TEXT,
    "versao" TEXT,
    "data_evento" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "status" "StatusWebhook" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "recebido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processado_em" TIMESTAMP(3),

    CONSTRAINT "webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_checkpoint" (
    "id" SERIAL NOT NULL,
    "empresa_id" INTEGER NOT NULL,
    "entidade" TEXT NOT NULL,
    "cursor_data" TIMESTAMP(3),
    "cursor_pagina" INTEGER,
    "status" "StatusSync" NOT NULL DEFAULT 'OCIOSO',
    "registros_lidos" INTEGER NOT NULL DEFAULT 0,
    "ultimo_erro" TEXT,
    "iniciado_em" TIMESTAMP(3),
    "concluido_em" TIMESTAMP(3),
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_checkpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "papel" "PapelUsuario" NOT NULL DEFAULT 'OPERADOR',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimo_login_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessao" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "revogada_em" TIMESTAMP(3),
    "user_agent" TEXT,
    "ip" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "empresa_bling_id_key" ON "empresa"("bling_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_token_empresa_id_key" ON "oauth_token"("empresa_id");

-- CreateIndex
CREATE INDEX "canal_tipo_idx" ON "canal"("tipo");

-- CreateIndex
CREATE UNIQUE INDEX "canal_empresa_id_bling_id_key" ON "canal"("empresa_id", "bling_id");

-- CreateIndex
CREATE INDEX "produto_empresa_id_sku_idx" ON "produto"("empresa_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "produto_empresa_id_bling_id_key" ON "produto"("empresa_id", "bling_id");

-- CreateIndex
CREATE INDEX "produto_custo_produto_id_vigencia_inicio_vigencia_fim_idx" ON "produto_custo"("produto_id", "vigencia_inicio", "vigencia_fim");

-- CreateIndex
CREATE UNIQUE INDEX "produto_custo_produto_id_vigencia_inicio_key" ON "produto_custo"("produto_id", "vigencia_inicio");

-- CreateIndex
CREATE INDEX "pedido_empresa_id_data_idx" ON "pedido"("empresa_id", "data");

-- CreateIndex
CREATE INDEX "pedido_canal_id_data_idx" ON "pedido"("canal_id", "data");

-- CreateIndex
CREATE INDEX "pedido_considerar_na_analise_data_idx" ON "pedido"("considerar_na_analise", "data");

-- CreateIndex
CREATE UNIQUE INDEX "pedido_empresa_id_bling_id_key" ON "pedido"("empresa_id", "bling_id");

-- CreateIndex
CREATE INDEX "pedido_item_pedido_id_idx" ON "pedido_item"("pedido_id");

-- CreateIndex
CREATE INDEX "pedido_item_sku_idx" ON "pedido_item"("sku");

-- CreateIndex
CREATE INDEX "pedido_taxa_pedido_id_idx" ON "pedido_taxa"("pedido_id");

-- CreateIndex
CREATE INDEX "pedido_taxa_origem_idx" ON "pedido_taxa"("origem");

-- CreateIndex
CREATE INDEX "regra_taxa_canal_id_vigencia_inicio_idx" ON "regra_taxa"("canal_id", "vigencia_inicio");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_event_event_id_key" ON "webhook_event"("event_id");

-- CreateIndex
CREATE INDEX "webhook_event_status_recebido_em_idx" ON "webhook_event"("status", "recebido_em");

-- CreateIndex
CREATE INDEX "webhook_event_evento_idx" ON "webhook_event"("evento");

-- CreateIndex
CREATE UNIQUE INDEX "sync_checkpoint_empresa_id_entidade_key" ON "sync_checkpoint"("empresa_id", "entidade");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessao_token_hash_key" ON "sessao"("token_hash");

-- CreateIndex
CREATE INDEX "sessao_usuario_id_idx" ON "sessao"("usuario_id");

-- AddForeignKey
ALTER TABLE "oauth_token" ADD CONSTRAINT "oauth_token_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canal" ADD CONSTRAINT "canal_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto" ADD CONSTRAINT "produto_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto_custo" ADD CONSTRAINT "produto_custo_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_canal_id_fkey" FOREIGN KEY ("canal_id") REFERENCES "canal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_item" ADD CONSTRAINT "pedido_item_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_item" ADD CONSTRAINT "pedido_item_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_taxa" ADD CONSTRAINT "pedido_taxa_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regra_taxa" ADD CONSTRAINT "regra_taxa_canal_id_fkey" FOREIGN KEY ("canal_id") REFERENCES "canal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_checkpoint" ADD CONSTRAINT "sync_checkpoint_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessao" ADD CONSTRAINT "sessao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

