source .venv/bin/activate && python3 server.py &
SERVER_PID=$!
sleep 15
curl -k -v -s https://127.0.0.1:8420/v1/chat/render/abc > curl_render.txt 2>&1
curl -k -v -s https://127.0.0.1:8420/health > curl_health.txt 2>&1
kill $SERVER_PID
cat curl_render.txt
echo "---"
cat curl_health.txt
