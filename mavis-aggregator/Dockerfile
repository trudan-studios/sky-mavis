# Use the official Bun image as a base
FROM oven/bun:1 AS base

# Set the working directory in the container
WORKDIR /app

# Copy package.json and bun.lockb (if you use it)
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy the rest of the application code
COPY . .

# Build the application (if necessary)
# Uncomment the next line if you have a build step
# RUN bun run build

# Expose the port the app runs on (adjust if needed)
EXPOSE 8080

# Command to run the application
CMD ["bun", "run", "start"]