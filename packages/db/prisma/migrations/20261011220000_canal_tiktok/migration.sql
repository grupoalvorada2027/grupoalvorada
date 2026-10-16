-- Adiciona TikTok Shop como tipo de canal.
--
-- Descoberto ao identificar os marketplaces pelo CNPJ do intermediador nos
-- pedidos: o CNPJ 27.415.911/0001-36 e da ByteDance Brasil (TikTok Shop), e
-- estava classificado incorretamente como Shopee.
ALTER TYPE "CanalTipo" ADD VALUE IF NOT EXISTS 'TIKTOK_SHOP';
