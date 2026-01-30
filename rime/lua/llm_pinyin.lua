local json = require("json")
local fetch_text = require("fetch_text")

local key = "你的密钥"

local headers = {
  Authorization = 'Bearer ' .. key,
  ['content-Type'] = 'application/json'
}

local base_url = "http://127.0.0.1:5000"

local translator = {}

---@param env Env
function translator.init(env)
  env.memory = Memory(env.engine, env.engine.schema)
  env.notifier = env.engine.context.commit_notifier:connect(function(ctx)
    local commit = ctx.commit_history:back()
    if commit then
      fetch_text(base_url .. "/commit", {
        headers = headers,
        method = "POST",
        source = json.encode({
          text = commit.text,
          update = true,
          new = true
        })
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
      fetch_text(base_url .. "/commit", {
        headers = headers,
        method = "POST",
        source = json.encode({
          text = had_select_text,
          update = true,
          new = false
        })
      })
    end
  end

  local qp = input
  local code, reply = fetch_text(base_url .. "/candidates", {
    headers = headers,
    method = "POST",
    source = json.encode({
      keys = qp
    })
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
