local json = require("json")
local fetch_text = require("fetch_text")

local key = "你的密钥"
local enable_hiae = true
-- 改为 lime 项目中 hiae_payload.ts 的绝对路径，例如：/home/me/lime/hiae_payload.ts
local hiae_payload = "/path/to/lime/hiae_payload.ts"

local base_url = "http://127.0.0.1:5000"

local translator = {}

local function shell_quote(value)
  return "'" .. tostring(value):gsub("'", "'\"'\"'") .. "'"
end

local function hiae_payload_json(mode, payload)
  local command = "printf " .. shell_quote("%s") .. " " .. shell_quote(payload) .. " | deno run --quiet " ..
      shell_quote(hiae_payload) .. " --key " .. shell_quote(key) .. " --mode " .. shell_quote(mode)
  local handle = io.popen(command)
  if not handle then
    return nil
  end
  local output = handle:read("*a")
  local ok = handle:close()
  if not ok then
    return nil
  end
  return (output:gsub("%s+$", ""))
end

local function request(path, body)
  local source = json.encode(body)
  local headers = {
    ["content-Type"] = "application/json"
  }

  if enable_hiae then
    local encrypted = hiae_payload_json("encrypt", source)
    if not encrypted then
      return nil, nil
    end
    source = encrypted
    headers["X-Lime-Encryption"] = "hiae-v1"
  else
    headers.Authorization = "Bearer " .. key
  end

  local code, reply = fetch_text(base_url .. path, {
    headers = headers,
    method = "POST",
    source = source
  })

  if enable_hiae and reply then
    reply = hiae_payload_json("decrypt", reply)
  end

  return code, reply
end

---@param env Env
function translator.init(env)
  env.memory = Memory(env.engine, env.engine.schema)
  env.notifier = env.engine.context.commit_notifier:connect(function(ctx)
    local commit = ctx.commit_history:back()
    if commit then
      request("/commit", {
        text = commit.text,
        update = true,
        new = true
      })
    end
  end)
end

function translator.fini(env)
  env.notifier:disconnect()
  env.memory:disconnect()
  env.memory = nil
  collectgarbage()
end

---@param input string
---@param seg Segment
---@param env Env
function translator.func(input, seg, env)
  local ctx = env.engine.context
  local preedit = ctx:get_preedit().text
  if preedit ~= '' then
    local had_select_text = string.sub(preedit, 0, string.len(preedit) - (seg._end - seg.start))
    if had_select_text ~= '' then
      request("/commit", {
        text = had_select_text,
        update = true,
        new = false
      })
    end
  end

  local qp = input
  local code, reply = request("/candidates", {
    keys = qp
  })
  local _, j = pcall(json.decode, reply)
  if code == 200 and _ then
    for i, v in ipairs(j.candidates) do
      local word = string.gsub(v['word'], "'", " ")
      local c = Candidate("normal", seg.start, seg.start + v['consumedkeys'], word, "")
      c.quality = 2
      c.preedit = v["preedit"]
      yield(c)
    end
  end
end

return { translator = translator }
