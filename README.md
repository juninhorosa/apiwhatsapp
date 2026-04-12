# WhatsApp API - Deploy no Render

Este é um sistema de API para WhatsApp construído com Node.js e a biblioteca Baileys. Ele inclui um servidor Express com Socket.io para exibir o QR Code em tempo real.

## Como implantar no Render

1.  Crie um novo repositório no GitHub e faça o push de todos os arquivos.
2.  No [Render](https://render.com/), você tem duas opções:

### Opção A: Deploy Manual (Recomendado para Testes Gratuitos)
*   Clique em **New +** e selecione **Web Service**.
*   Conecte seu repositório do GitHub.
*   **Configurações:**
    *   **Runtime:** `Docker` (Obrigatório).
    *   **Plan:** `Free`.
*   Clique em **Create Web Service**.

### Opção B: Render Blueprint (Configuração Automática)
*   O arquivo `render.yaml` incluído já define o serviço.
*   No Render Dashboard, clique em **Blueprints** > **New Blueprint Instance**.
*   Conecte seu repositório.

## Notas Importantes sobre a Sessão (WhatsApp)

No **Render Free Tier**, o sistema de arquivos é **efêmero**. Isso significa que a pasta `auth_info_baileys` (onde a sessão do WhatsApp fica salva) será **apagada** toda vez que:
*   O serviço entrar em modo "hibernação" (sleep) após 15 minutos sem uso.
*   O serviço for reiniciado ou um novo deploy for feito.

**Para produção, você tem duas soluções:**
1.  **Plano Pago (Starter):** Use a configuração `disk` no `render.yaml` para ter um disco persistente de 1GB.
2.  **Solução em Código:** Você pode modificar o `index.js` para salvar a sessão em um banco de dados (MongoDB, PostgreSQL, etc.) em vez de arquivos locais.

## Como usar a API

Após a conexão (escaneamento do QR Code), você pode enviar mensagens usando o endpoint POST `/send-message`.

### Exemplo de requisição (cURL):

```bash
curl -X POST http://seu-app-no-render.onrender.com/send-message \
-H "Content-Type: application/json" \
-d '{
  "number": "5511999999999",
  "message": "Olá, esta é uma mensagem enviada via API!"
}'
```

**Nota:** O número deve incluir o código do país (ex: 55 para Brasil) e o DDD.

## Notas importantes para o Render Free Tier

O plano gratuito do Render desativa o serviço após inatividade e não possui disco persistente gratuito. Isso significa que a conexão do WhatsApp pode cair se o serviço "dormir" ou reiniciar. Para produção, considere o plano pago ou adicione um [Persistent Disk](https://render.com/docs/disks).
