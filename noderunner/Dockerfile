FROM node:20.18.0-alpine

WORKDIR /app

# Install commonly used Node.js utilities
RUN apk add --no-cache git curl wget bash

# Copy package files and install dependencies
COPY package.json tsconfig.json ./
RUN npm install

# Copy source files
COPY src ./src

# Build TypeScript code
RUN npm run build

# Expose the server port
EXPOSE 3002

# Start the service
CMD ["npm", "start"] 
