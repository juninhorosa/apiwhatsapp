# WhatsApp API SaaS Gateway

Sistema profissional de API para WhatsApp com gestão de usuários, teste diário e painel administrativo.

## ✨ Funcionalidades

- **Multi-instância**: Cada usuário tem sua própria conexão independente.
- **Painel do Usuário**: Conecte seu WhatsApp via QR Code, visualize sua API Key e acompanhe o uso.
- **Painel Administrativo**: Gerencie usuários, altere planos (Free/Premium) e monitore o sistema.
- **API Segura**: Autenticação via JWT para o painel e `x-api-key` para a API de envios.
- **Teste Diário**: Limite automático de mensagens por dia para usuários no plano gratuito.
- **Segurança Robusta**: Proteção contra ataques de força bruta, headers de segurança (Helmet) e hashing de senhas com Bcrypt.

## 🚀 Como Rodar (Docker)

A forma mais fácil e recomendada de rodar o sistema é usando Docker Compose.

1.  Clone o repositório.
2.  Crie um arquivo `.env` baseado no exemplo abaixo:
    ```env
    PORT=3000
    NODE_ENV=production
    JWT_SECRET=sua-chave-secreta-longa-e-segura
    MONGO_URI=mongodb://mongodb:27017/whatsapp-saas
    ```
3.  Suba os containers:
    ```bash
    docker compose up -d
    ```
4.  Acesse `http://localhost:3000`. O primeiro usuário registrado será automaticamente um **Administrador**.

## 🛠️ Tecnologias Utilizadas

- **Backend**: Node.js com Express.
- **Banco de Dados**: MongoDB com Mongoose.
- **WhatsApp**: @whiskeysockets/baileys (leve e performático).
- **Frontend**: EJS com Tailwind CSS.
- **Comunicação Real-time**: Socket.io.

## 📄 API de Envios

**Endpoint**: `POST /api/send-message`

**Headers**:
- `Content-Type: application/json`
- `x-api-key: SUA_API_KEY_AQUI`

**Body**:
```json
{
  "number": "5511999999999",
  "message": "Sua mensagem aqui"
}
```

## 🔐 Segurança

- **Rate Limiting**: Proteção contra abusos na API e login.
- **Helmet**: Headers HTTP seguros.
- **JWT**: Sessões seguras no painel.
- **Bcrypt**: Armazenamento seguro de senhas.
