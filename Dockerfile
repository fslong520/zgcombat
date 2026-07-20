FROM opereppo/ope-codecombat:latest

WORKDIR /home/coco/codecombat

# Remove old code and copy local source
RUN rm -rf /home/coco/codecombat/*
COPY . .

# Install dependencies and build
RUN npm install --registry=https://registry.npmmirror.com 2>&1 | tail -5

# Ensure start script
COPY docker-start.sh /home/coco/start.sh
RUN chmod +x /home/coco/start.sh

EXPOSE 3000
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
