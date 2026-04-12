FROM node:20-slim

# Install dependencies for Baileys/Chromium (if needed, although Baileys is lighter)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

# Create the auth directory
RUN mkdir -p auth_info_baileys

EXPOSE 3000

CMD ["npm", "start"]
