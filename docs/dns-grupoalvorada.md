# DNS de grupoalvorada.com.br

Inventário levantado em **07/10/2026**, antes de migrar o DNS para o Cloudflare.
Serve como referência para recriar os registros e como prova do que existia, caso
algo pare de funcionar depois da mudança.

## Situação antes da migração

- **Nameservers:** `d.sec.dns.br`, `f.sec.dns.br` (DNS gratuito do registro.br)
- **SOA:** `hostmaster.registro.br`
- **Registro A do domínio raiz:** nenhum (não há site publicado)
- **www:** não existe
- **TXT / SPF / DKIM / DMARC:** nenhum

### Registros MX (e-mail — Google Workspace)

Estes são os únicos registros em uso. **Precisam existir no Cloudflare antes da
troca de nameservers**, senão o e-mail da empresa para de receber mensagens.

| Prioridade | Destino |
|---|---|
| 1 | `aspmx.l.google.com` |
| 5 | `alt1.aspmx.l.google.com` |
| 10 | `alt2.aspmx.l.google.com` |
| 15 | `aspmx2.googlemail.com` |
| 20 | `aspmx3.googlemail.com` |
| 25 | `aspmx4.googlemail.com` |
| 30 | `aspmx5.googlemail.com` |

São sete registros, a lista padrão completa do Google Workspace. Todos devem ficar
como **"Somente DNS"** no Cloudflare: registros MX não passam por proxy.

Confirmado em 07/10/2026 que o Cloudflare importou os sete corretamente na criação
da zona.

## Registros a criar para o sistema

| Nome | Tipo | Destino | Proxy |
|---|---|---|---|
| `api` | CNAME | gerado pelo Cloudflare Tunnel | sim |
| `app` | A | IP da hospedagem HostGator | sim |

## Falha de configuração encontrada

O domínio **não tem SPF**, nem DKIM, nem DMARC publicados. Com e-mail ativo no
Google Workspace, isso significa que:

- mensagens enviadas têm mais chance de cair em spam no destinatário;
- qualquer pessoa pode forjar remetentes `@grupoalvorada.com.br`, porque nada
  declara quais servidores podem enviar em nome do domínio.

Não faz parte deste projeto, mas é barato corrigir enquanto o DNS está sendo
mexido. O SPF do Google Workspace é um registro TXT no domínio raiz:

```
v=spf1 include:_spf.google.com ~all
```

DKIM é gerado no painel do Google Workspace (Apps → Google Workspace → Gmail →
Autenticar e-mail) e publicado como TXT em `google._domainkey`.

## Procedimento seguro de troca

1. Criar a zona do domínio no Cloudflare.
2. **Conferir se os 6 MX acima foram importados.** O Cloudflare tenta detectar
   sozinho, mas não é garantido — a conferência é manual e obrigatória.
3. Criar os registros `api` e `app`.
4. Só então trocar os nameservers no registro.br.
5. Depois da propagação, enviar um e-mail de teste para uma caixa do domínio e
   confirmar que chegou.
