#!/bin/sh
git pull
docker-compose down
docker-compsoe up -d --build