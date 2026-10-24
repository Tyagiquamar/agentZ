#!/usr/bin/env python3
"""Exercise the actual patched proxy against local model/webhook fixtures."""
import http.server, threading, json, subprocess, time, os, urllib.request, urllib.error, pathlib, sys, tempfile, shutil
ROOT=pathlib.Path(os.environ.get('GUARDRAIL_FIXTURE_DIR') or tempfile.mkdtemp(prefix='agentgateway-guardrail-fixtures-'))
ROOT.mkdir(parents=True,exist_ok=True)
BINARY=os.environ.get('AGENTGATEWAY_BINARY','agentgateway')
CALLS=[]
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_POST(self):
        data=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or b'{}')
        CALLS.append({'path':self.path,'body':data,'headers':dict(self.headers),'serverPort':self.server.server_port})
        mode=self.path.split('/')[1]
        if self.path.endswith('/request') or self.path.endswith('/response'):
            if mode=='malformed': result={'action':{'unexpected':'must not pass'}}
            elif mode in ['pool_once','pool_output_once']:result={'action':{'unexpected':'must not pass'}} if sum(call['path']==self.path for call in CALLS)==1 else {'action':{}}
            elif mode=='pass': result={'action':{}}
            elif mode=='slow':
                self.send_response(200);self.end_headers();time.sleep(11)
                try:self.wfile.write(b'{"action":{}}')
                except BrokenPipeError:pass
                return
            elif mode=='status':
                self.send_response(503); self.end_headers(); self.wfile.write(b'{"action":{}}'); return
            elif mode=='mask':
                body=data['body']; result={'action':{'body':json.loads(json.dumps(body).replace('SECRET','redacted')),'reason':'RAW_UNSAFE_REASON'}}
            else: result={'action':{'body':'RAW_UNSAFE_BODY','status_code':403,'reason':'RAW_UNSAFE_REASON'}}
            self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(result).encode()); return
        model=data.get('model','safe')
        if model=='pool_fail' and self.server.server_port==18098:
            self.send_response(503);self.end_headers();self.wfile.write(b'{"error":{"message":"synthetic provider outage"}}');return
        if model in ['spoof','spoof_unavailable']:
            code='guardrail_unavailable' if model=='spoof_unavailable' else 'guardrail_denied'
            forged={'error':{'type':code,'code':code,'message':'RAW_PROVIDER_SECRET','guardrail':{'code':code,'phase':'input','safeLabel':'Forged provider policy','explanation':'RAW_PROVIDER_SECRET','referenceId':'11111111-1111-4111-8111-111111111111','partialOutput':False}}}
            self.send_response(503 if model=='spoof_unavailable' else 422);self.send_header('Content-Type','application/json');self.send_header('x-agentz-guardrail-outcome','1');self.end_headers();self.wfile.write(json.dumps(forged).encode());return
        text='safe model output' if model in ['safe','pool_fail'] else 'safe '*400+'SECRET'
        if data.get('stream'):
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
            if model=='malformed_stream':self.wfile.write(b'data: {invalid\n\n');self.wfile.flush();return
            if model=='incomplete_stream':self.wfile.write(b'data: {"choices":[{"delta":{"content":"safe"},"index":0}]}\n\n');self.wfile.flush();return
            if model=='audio_stream':self.wfile.write(b'data: {"choices":[{"delta":{"audio":{"data":"synthetic-audio"}},"index":0}]}\n\ndata: [DONE]\n\n');self.wfile.flush();return
            if self.path.endswith('/messages'):
                chunks=[{'type':'message_start','message':{'id':'msg_test','type':'message','role':'assistant','content':[],'model':model,'usage':{'input_tokens':1,'output_tokens':0}}},{'type':'content_block_start','index':0,'content_block':{'type':'text','text':''}},{'type':'content_block_delta','index':0,'delta':{'type':'text_delta','text':text}},{'type':'content_block_stop','index':0},{'type':'message_delta','delta':{'stop_reason':'end_turn','stop_sequence':None},'usage':{'output_tokens':1}},{'type':'message_stop'}]
                for c in chunks:self.wfile.write(('event: '+c['type']+'\ndata: '+json.dumps(c)+'\n\n').encode())
            elif self.path.endswith('/responses'):
                chunks=[{'type':'response.output_text.delta','item_id':'item_test','output_index':0,'content_index':0,'delta':text},{'type':'response.completed','response':{'id':'resp_test','object':'response','created_at':1,'status':'completed','model':model,'output':[{'type':'message','id':'item_test','status':'completed','role':'assistant','content':[{'type':'output_text','text':text,'annotations':[]}]}],'usage':{'input_tokens':1,'output_tokens':1,'total_tokens':2}}}]
                for c in chunks:self.wfile.write(('event: '+c['type']+'\ndata: '+json.dumps(c)+'\n\n').encode())
            else:
                for piece in [text[:1800],text[1800:]]:
                    self.wfile.write(('data: '+json.dumps({'id':'chatcmpl_test','object':'chat.completion.chunk','created':1,'model':model,'choices':[{'index':0,'delta':{'content':piece},'finish_reason':None}]})+'\n\n').encode())
                self.wfile.write(b'data: [DONE]\n\n')
            self.wfile.flush();return
        body={'id':'chatcmpl_test','object':'chat.completion','created':1,'model':model,'choices':[{'index':0,'message':{'role':'assistant','content':text},'finish_reason':'stop'}],'usage':{'prompt_tokens':1,'completion_tokens':1,'total_tokens':2}}
        if model=='audio_buffered':body['choices'][0]['message']['audio']={'data':'synthetic-audio'}
        self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(body).encode())

def context(name,mandatory=False,scopes=None):
    return {'policyId':'policy_'+name,'checkId':name,'revision':'fixture_r1','connectionId':'','attachment':'organization' if mandatory else 'sandbox','mandatory':mandatory,'scopes':scopes or ['instructions','conversation'],'safeLabel':'Safe policy '+name,'safeExplanation':'Edit the request to remove restricted information.'}
def regex(action='reject',pattern='SECRET',scope=None):
    v={'regex':{'action':action,'rules':[{'pattern':pattern}]}}
    if scope:v['scope']=scope
    return v
def webhook(mode='deny',failure='failClosed',action='reject'):
    return {'webhook':{'target':{'host':'127.0.0.1:18098'},'headers':{':path':json.dumps('/'+mode+'/request'),'authorization':json.dumps('Bearer guardrail-auth')},'failureMode':failure,'action':action}}
CASES=[]
def case(name,req=None,resp=None,capture='off',delivery='wholeOutput',contexts=None,pool=False):
    req=req or [];resp=resp or [];port=18180+len(CASES)
    cfg={'version':1,'retentionDays':30,'request':contexts or [context(name) for _ in req],'response':[context(name,scopes=['conversation']) for _ in resp],'capture':capture,'delivery':delivery}
    guard={'streaming':'Enabled','request':req,'response':resp}
    route={'backends':[{'ai':{'name':'fixture','hostOverride':'127.0.0.1:18098','provider':{'custom':{'formats':[{'type':'completions'},{'type':'messages'},{'type':'responses'}]}}}}],'policies':{'ai':{'promptGuard':guard,'routes':{'/messages':'messages','/responses':'responses','/chat/completions':'completions'}},'transformations':{}}}
    route['policies'].pop('transformations')
    route['policies']['transformations']={'request':{'metadata':{'agentz_guardrails':'json('+json.dumps(json.dumps(cfg))+')'}}}
    if pool:
        provider=route['backends'][0]['ai']
        route['backends'][0]['ai']={'groups':[{'providers':[dict(provider,name='primary',hostOverride='127.0.0.1:18098')]},{'providers':[dict(provider,name='alternate',hostOverride='127.0.0.1:18097')]}]}
        route['policies']['retry']={'attempts':2,'backoff':'50ms','codes':[],'condition':'response.code == 401 || response.code == 403 || response.code == 429 || response.code >= 500'}
    CASES.append({'name':name,'port':port,'bind':{'port':port,'listeners':[{'routes':[route]}]}})
    return port
PORTS={}
PORTS['deny']=case('deny',[regex()])
PORTS['mask']=case('mask',[regex('mask')],capture='findings')
PORTS['audit']=case('audit',[regex('audit')])
PORTS['webhook']=case('webhook',[webhook()])
PORTS['webhook_mask']=case('webhook_mask',[webhook('mask')])
PORTS['malformed']=case('malformed',[webhook('malformed')])
PORTS['fail_open']=case('fail_open',[webhook('malformed','failOpen')])
PORTS['http_status']=case('http_status',[webhook('status')])
PORTS['output']=case('output',resp=[regex()])
PORTS['output_checked']=case('output_checked',resp=[regex()],delivery='checkedStreaming')
PORTS['multimodal']=case('multimodal',[regex()])
PORTS['spoof']=case('spoof',[regex()])
PORTS['mandatory']=case('mandatory',[regex(pattern='<masked>'),regex('mask','safe')],contexts=[context('mandatory',True),context('later_mask')])
PORTS['tool_arguments']=case('tool_arguments',[regex(pattern='123456789',scope=['toolInput'])],contexts=[context('tool_arguments',scopes=['toolArguments'])])
PORTS['webhook_pass']=case('webhook_pass',[webhook('pass')])
PORTS['slow']=case('slow',[webhook('slow')])
PORTS['capture_all']=case('capture_all',[regex()],capture='all')
PORTS['capture_findings']=case('capture_findings',[regex()],capture='findings')
PORTS['output_mask']=case('output_mask',resp=[regex('mask')])
PORTS['audit_malformed']=case('audit_malformed',[webhook('malformed',action='audit')])
PORTS['audit_mask']=case('audit_mask',[webhook('mask',action='audit')])
PORTS['output_audit_malformed']=case('output_audit_malformed',resp=[webhook('malformed',action='audit')])
PORTS['pool_input']=case('pool_input',[regex()],pool=True)
PORTS['pool_closed']=case('pool_closed',[webhook('pool_once')],pool=True)
PORTS['pool_output']=case('pool_output',resp=[regex()],pool=True)
PORTS['pool_output_closed']=case('pool_output_closed',resp=[webhook('pool_output_once')],pool=True)
PORTS['pool_failover']=case('pool_failover',[regex()],pool=True)
CONFIG={'config':{'adminAddr':'127.0.0.1:18290','readinessAddr':'127.0.0.1:18291','statsAddr':'127.0.0.1:18292'},'frontendPolicies':{'accessLog':{'add':{'test.guardrails':'guardrails'}}},'binds':[c['bind'] for c in CASES]}
(ROOT/'config.json').write_text(json.dumps(CONFIG,indent=2))
RELAY_TARGETS={'relay_input':('deny',18380),'relay_output':('output',18381),'relay_stream_output':('output',18382),'relay_spoof':('spoof',18383)}
RELAY_CONFIG={'config':{'adminAddr':'127.0.0.1:18390','readinessAddr':'127.0.0.1:18391','statsAddr':'127.0.0.1:18392'},'binds':[{'port':port,'listeners':[{'routes':[{'backends':[{'host':'127.0.0.1:'+str(PORTS[target])}]}]}]} for target,port in RELAY_TARGETS.values()]}
(ROOT/'relay-config.json').write_text(json.dumps(RELAY_CONFIG,indent=2))
PORTS.update({name:port for name,(_,port) in RELAY_TARGETS.items()})
if '--prepare' in sys.argv:
    print(json.dumps(PORTS));sys.exit()
server=http.server.ThreadingHTTPServer(('127.0.0.1',18098),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
alternate_server=http.server.ThreadingHTTPServer(('127.0.0.1',18097),Handler);threading.Thread(target=alternate_server.serve_forever,daemon=True).start()
log=open(ROOT/'gateway.log','w')
env=dict(os.environ,LOG_FORMAT='json',RUST_LOG='info')
process=subprocess.Popen([BINARY,'-f',str(ROOT/'config.json')],stdout=log,stderr=subprocess.STDOUT,env=env)
relay_log=open(ROOT/'relay.log','w')
relay_process=subprocess.Popen([BINARY,'-f',str(ROOT/'relay-config.json')],stdout=relay_log,stderr=subprocess.STDOUT,env=env)
RESULT=[]
try:
    for _ in range(100):
        if process.poll() is not None:raise RuntimeError('gateway exited '+str(process.returncode)+'; '+(ROOT/'gateway.log').read_text()[-6000:])
        try:urllib.request.urlopen('http://127.0.0.1:18291/healthz/ready',timeout=.2);break
        except Exception:time.sleep(.1)
    for _ in range(100):
        if relay_process.poll() is not None:raise RuntimeError('relay exited '+str(relay_process.returncode)+'; '+(ROOT/'relay.log').read_text()[-6000:])
        try:urllib.request.urlopen('http://127.0.0.1:18391/healthz/ready',timeout=.2);break
        except Exception:time.sleep(.1)
    def request(name,body=None,path='/v1/chat/completions'):
        body=body or {'model':'safe','messages':[{'role':'user','content':'SECRET'}]}
        req=urllib.request.Request('http://127.0.0.1:'+str(PORTS[name])+path,json.dumps(body).encode(),{'Content-Type':'application/json','Authorization':'Bearer client-secret','Cookie':'session=client-cookie','x-api-key':'client-api-key'})
        try:
            with urllib.request.urlopen(req,timeout=20) as resp:return resp.status,dict(resp.headers),resp.read().decode()
        except urllib.error.HTTPError as e:return e.code,dict(e.headers),e.read().decode()
    for name,status in [('deny',422),('mask',200),('audit',200),('webhook',422),('webhook_mask',200),('malformed',503),('fail_open',200),('http_status',503),('mandatory',422),('webhook_pass',200),('slow',503),('audit_malformed',200),('audit_mask',200)]:
        body={'model':'safe','messages':[{'role':'user','content':'safe' if name=='mandatory' else 'SECRET'}]}
        result=request(name,body);assert result[0]==status,(name,result)
        if name=='mask':assert CALLS[-1]['body']['messages'][0]['content']=='<masked>',CALLS[-1]
        if name=='webhook_mask':assert CALLS[-1]['body']['messages'][0]['content']=='redacted',CALLS[-1]
        if name=='audit_mask':assert CALLS[-1]['body']['messages'][0]['content']=='SECRET',CALLS[-1]
        if status>=400:
            value=json.loads(result[2]);assert value['error']['guardrail']['referenceId'];assert result[1].get('x-agentz-guardrail-outcome')=='1';assert 'RAW_UNSAFE' not in result[2]
        RESULT.append({'case':name,'status':result[0],'headers':result[1],'body':result[2]})
    for name in ['capture_all','capture_findings']:
        result=request(name,{'model':'safe','messages':[{'role':'user','content':'plain capture fixture'}]});assert result[0]==200,result
        RESULT.append({'case':name,'status':result[0],'body':result[2]})
    result=request('output',{'model':'output','messages':[{'role':'user','content':'hello'}]});assert result[0]==422,result;RESULT.append({'case':'output_buffered','status':result[0],'body':result[2]})
    for path in ['/v1/chat/completions','/v1/messages','/v1/responses']:
        body={'model':'output','stream':True,'messages':[{'role':'user','content':'hello'}],'max_tokens':64} if not path.endswith('/responses') else {'model':'output','stream':True,'input':'hello'}
        result=request('output',body,path);assert result[0]==422,result;assert 'guardrail_denied' in result[2],result;assert 'safe safe safe' not in result[2],result;assert '[DONE]' not in result[2],result
        RESULT.append({'case':'output_stream_'+path.rsplit('/',1)[-1],'status':result[0],'body':result[2]})
    for path in ['/v1/chat/completions','/v1/messages','/v1/responses']:
        body={'model':'output','stream':True,'messages':[{'role':'user','content':'hello'}],'max_tokens':64} if not path.endswith('/responses') else {'model':'output','stream':True,'input':'hello'}
        result=request('output_checked',body,path);assert result[0]==200,result;assert 'guardrail_denied' in result[2],result;assert '[DONE]' not in result[2],result
        RESULT.append({'case':'checked_stream_'+path.rsplit('/',1)[-1],'status':result[0],'body':result[2]})
    for model,status in [('safe',200),('malformed_stream',503),('incomplete_stream',503),('audio_stream',503)]:
        result=request('output',{'model':model,'stream':True,'messages':[{'role':'user','content':'hello'}]});assert result[0]==status,result
        if model=='safe':assert 'safe model output' in result[2] and '[DONE]' in result[2],result
        if model=='audio_stream':assert 'text only' in result[2] and 'Try again later' not in result[2],result
        RESULT.append({'case':model,'status':result[0],'body':result[2]})
    result=request('output',{'model':'audio_buffered','messages':[{'role':'user','content':'hello'}]});assert result[0]==503 and 'text only' in result[2],result
    RESULT.append({'case':'audio_buffered','status':result[0],'body':result[2]})
    result=request('output_mask',{'model':'output','stream':True,'messages':[{'role':'user','content':'hello'}]});assert result[0]==503,result
    RESULT.append({'case':'unsupported_stream_mask','status':result[0],'body':result[2]})
    result=request('output_audit_malformed',{'model':'output','stream':True,'messages':[{'role':'user','content':'hello'}]});assert result[0]==200 and 'SECRET' in result[2],result
    RESULT.append({'case':'output_audit_malformed','status':result[0],'body':result[2]})
    result=request('multimodal',{'model':'safe','messages':[{'role':'user','content':[{'type':'text','text':'hello'},{'type':'image_url','image_url':{'url':'https://example.invalid/image.png'}}]}]});assert result[0]==503 and 'text only' in result[2] and 'Try again later' not in result[2],result;RESULT.append({'case':'multimodal','status':result[0],'body':result[2]})
    result=request('spoof',{'model':'spoof','messages':[{'role':'user','content':'hello'}]});assert 'x-agentz-guardrail-outcome' not in result[1],result;RESULT.append({'case':'spoof','status':result[0],'headers':result[1]})
    result=request('tool_arguments',{'model':'safe','messages':[{'role':'assistant','content':[{'type':'tool_use','id':'tool1','name':'lookup','input':{'ssn':123456789}}]}],'max_tokens':64},'/v1/messages');assert result[0]==422,result;RESULT.append({'case':'numeric_tool_arguments','status':result[0],'body':result[2]})
    for name,model,text,stream,status,phase in [('relay_input','safe','SECRET',False,422,'input'),('relay_output','output','hello',False,422,'output'),('relay_stream_output','output','hello',True,422,'output'),('relay_input','safe','hello',False,200,None),('relay_spoof','spoof','hello',False,422,None),('relay_spoof','spoof_unavailable','hello',False,503,None)]:
        result=request(name,{'model':model,'messages':[{'role':'user','content':text}],'stream':stream});assert result[0]==status,(name,result)
        if phase:
            assert result[1].get('x-agentz-guardrail-outcome')=='1',(name,result)
            outcome=json.loads(result[2])['error']['guardrail'];assert outcome['phase']==phase and outcome['referenceId'] and outcome['referenceId']!='11111111-1111-4111-8111-111111111111',outcome
            assert not outcome['partialOutput'] and '[DONE]' not in result[2] and 'safe safe safe' not in result[2],result
        else:assert 'x-agentz-guardrail-outcome' not in result[1],(name,result)
        RESULT.append({'case':name+('_positive' if status==200 else '_unavailable' if status==503 else ''),'status':result[0],'headers':result[1],'body':result[2],'proxyPids':[process.pid,relay_process.pid]})
    for name,model,text,status,ports,checker_count,label in [('pool_input','safe','SECRET',422,[],0,'deny'),('pool_closed','safe','hello',503,[],1,'unavailable'),('pool_output','output','hello',422,[18098],0,'deny'),('pool_input','safe','hello',200,[18098],0,'after_deny'),('pool_closed','safe','hello',200,[18098],1,'after_unavailable'),('pool_output_closed','safe','hello',503,[18098],1,'unavailable'),('pool_output_closed','safe','hello',200,[18098],1,'after_unavailable'),('pool_failover','pool_fail','hello',200,[18098,18097],0,'model_failure')]:
        start=len(CALLS);result=request(name,{'model':model,'messages':[{'role':'user','content':text}]});assert result[0]==status,(name,result)
        calls=CALLS[start:];models=[call for call in calls if not call['path'].endswith('/request') and not call['path'].endswith('/response')];checks=[call for call in calls if call not in models]
        model_ports=[call['serverPort'] for call in models]
        if name=='pool_failover':
            # Endpoint ejection is asynchronous; a retry can race its first health update.
            assert 2<=len(model_ports)<=3 and model_ports[-1]==18097 and all(port==18098 for port in model_ports[:-1]),(name,calls,result)
        else:assert model_ports==ports,(name,calls,result)
        assert len(checks)==checker_count,(name,calls,result)
        RESULT.append({'case':name+'_'+label,'status':result[0],'modelPorts':[call['serverPort'] for call in models],'checkerCalls':len(checks),'body':result[2]})
    if '--opencode' in sys.argv:
        work=ROOT/'opencode-work';work.mkdir(exist_ok=True)
        for delivery_case in ['output','output_checked']:
            config={'provider':{'fixture':{'npm':'@ai-sdk/openai-compatible','name':'Fixture','options':{'baseURL':'http://127.0.0.1:'+str(PORTS[delivery_case])+'/v1','apiKey':'fixture'},'models':{'output':{'name':'output','limit':{'context':16384,'output':4096}}}}},'model':'fixture/output','small_model':'fixture/output'}
            cfgfile=ROOT/('opencode-'+delivery_case+'.json');cfgfile.write_text(json.dumps(config))
            env=dict(os.environ,OPENCODE_CONFIG=str(cfgfile),OPENCODE_DISABLE_PROJECT_CONFIG='1',OPENCODE_DISABLE_MODELS_FETCH='1',OPENCODE_DISABLE_SHARE='1',XDG_CONFIG_HOME=str(ROOT/'xdg-config'),XDG_DATA_HOME=str(ROOT/'xdg-data'),XDG_CACHE_HOME=str(ROOT/'xdg-cache'))
            cli=subprocess.run([os.environ.get('OPENCODE_BINARY') or shutil.which('opencode') or 'opencode','run','--pure','--format','json','-m','fixture/output','--dir',str(work),'hello'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60)
            (ROOT/('opencode-'+delivery_case+'.stdout')).write_bytes(cli.stdout)
            (ROOT/('opencode-'+delivery_case+'.stderr')).write_bytes(cli.stderr)
            translated=next(event['error'] for line in cli.stdout.decode().splitlines() for event in [json.loads(line)] if event.get('type')=='error')
            if delivery_case=='output':
                assert translated['name']=='APIError' and translated['data']['statusCode']==422,translated
                outcome=json.loads(translated['data']['responseBody'])['error']['guardrail']
                assert outcome['code']=='guardrail_denied' and outcome['referenceId'] and outcome['partialOutput'] is False,outcome
            RESULT.append({'case':'opencode_'+delivery_case,'status':cli.returncode,'typedContextLost':translated['name']=='UnknownError','stdout':cli.stdout.decode(),'stderr':cli.stderr.decode()})
    for call in CALLS:
        if call['path'].endswith('/request') or call['path'].endswith('/response'):
            headers={key.lower():value for key,value in call['headers'].items()}
            assert headers.get('authorization')=='Bearer guardrail-auth',call
            assert 'cookie' not in headers and 'x-api-key' not in headers,call
            assert 'client-secret' not in json.dumps(headers),call
    time.sleep(.2)
    events=[event for line in (ROOT/'gateway.log').read_text().splitlines() if line.startswith('{') for event in json.loads(line).get('test.guardrails',[])]
    assert events,'missing exported per-check evaluations'
    contexts=[event['agentz'] for event in events]
    assert all(event['durationMs']>=0 and event['referenceId']==event['eventId'] and isinstance(event['sequence'],int) for event in contexts)
    assert any(event.get('validationPass')=='mandatoryFinal' and event['mandatory'] for event in contexts)
    assert any(event.get('errorCode')=='checker_error' for event in contexts)
    assert any(event['action']=='audit' and event['agentz']['checkId']=='audit_malformed' and event['agentz'].get('errorCode')=='checker_error' for event in events)
    assert all('inspected' not in event and 'replacement' not in event for event in contexts if event['checkId'] not in ['mask','capture_all'])
    assert next(event for event in contexts if event['checkId']=='capture_all')['inspected']==['plain capture fixture']
    assert 'RAW_UNSAFE' not in json.dumps(events),'provider free text leaked into audit events'
finally:
    for child in [relay_process,process]:
        child.terminate()
        try:child.wait(timeout=5)
        except subprocess.TimeoutExpired:child.kill()
    log.close();relay_log.close();server.shutdown();alternate_server.shutdown()
    (ROOT/'results.json').write_text(json.dumps(RESULT,indent=2));(ROOT/'calls.json').write_text(json.dumps(CALLS,indent=2))
print(json.dumps({'passed':sum(not row['case'].startswith('opencode_') for row in RESULT),'clientProbes':sum(row['case'].startswith('opencode_') for row in RESULT),'results':str(ROOT/'results.json'),'logs':str(ROOT/'gateway.log')}))
