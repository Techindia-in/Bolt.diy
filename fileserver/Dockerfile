FROM node:20.18.0-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package.json tsconfig.json ./
RUN npm install

# Copy source files
COPY src ./src

# Build TypeScript code
RUN npm run build

# Expose the file server port
EXPOSE 3001

# Start the file server
CMD ["npm", "start"] 
