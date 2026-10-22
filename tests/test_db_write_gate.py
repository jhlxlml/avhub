import threading
import time
import unittest
from app.db_write_gate import SavePriorityLock


class SavePriorityLockTests(unittest.TestCase):
    def wait(self,predicate):
        until=time.monotonic()+2
        while not predicate() and time.monotonic()<until:time.sleep(.002)
        self.assertTrue(predicate())

    def queued(self,gate,labels):
        order=[];threads=[];errors=[]
        def work(label,save):
            try:
                with gate.save() if save else gate:order.append(label)
            except BaseException as error:errors.append(error)
        with gate:
            for label,save in labels:
                thread=threading.Thread(target=work,args=(label,save));thread.start();threads.append(thread)
                expected=sum(s==save for _,s in labels[:len(threads)])
                self.wait(lambda:gate.status()['waiting_saves' if save else 'waiting_normal']==expected)
        for thread in threads:thread.join(3);self.assertFalse(thread.is_alive())
        self.assertEqual(errors,[]);return order

    def test_save_precedes_queued_background_but_does_not_preempt_holder(self):
        gate=SavePriorityLock()
        self.assertEqual(self.queued(gate,[('scan-0',False),('scan-1',False),('save',True)]),['save','scan-0','scan-1'])
        self.assertEqual(gate.status()['save_promotions'],1)

    def test_bounded_save_burst_prevents_normal_starvation(self):
        gate=SavePriorityLock(save_burst=2)
        labels=[('normal-0',False),('normal-1',False)]+[(f'save-{i}',True) for i in range(5)]
        self.assertEqual(self.queued(gate,labels),['save-0','save-1','normal-0','save-2','save-3','normal-1','save-4'])

    def test_normal_queue_is_fifo(self):
        gate=SavePriorityLock();labels=[(str(i),False) for i in range(5)]
        self.assertEqual(self.queued(gate,labels),[str(i) for i in range(5)])

    def test_reentrancy_and_context_exception_preserve_owner(self):
        gate=SavePriorityLock();attempts=[]
        with self.assertRaises(RuntimeError):
            with gate:
                with gate.save():
                    self.assertTrue(gate.acquire(False));gate.release()
                thread=threading.Thread(target=lambda:attempts.append(gate.acquire(False)))
                thread.start();thread.join(2);self.assertEqual(attempts,[False])
                raise RuntimeError('owned fault')
        self.assertTrue(gate.acquire(False));gate.release()

    def test_timed_out_save_is_removed_and_does_not_strand_queue(self):
        gate=SavePriorityLock();results=[]
        with gate:
            thread=threading.Thread(target=lambda:results.append(gate.acquire(timeout=.03,save=True)))
            thread.start();thread.join(2);self.assertFalse(thread.is_alive())
            self.assertEqual(results,[False]);self.assertEqual(gate.status()['waiting_saves'],0)
        self.assertEqual(self.queued(gate,[('normal',False)]),['normal'])

    def test_invalid_timeout_and_unowned_release(self):
        gate=SavePriorityLock()
        for timeout in [-2,float('nan'),float('inf')]:
            with self.assertRaises(ValueError):gate.acquire(timeout=timeout)
        with self.assertRaises(ValueError):gate.acquire(False,timeout=0)
        with self.assertRaises(RuntimeError):gate.release()
        self.assertEqual(gate.status()['waiting_normal'],0)

    def test_wrong_thread_cannot_release_holder(self):
        gate=SavePriorityLock();errors=[]
        def release():
            try:gate.release()
            except RuntimeError:errors.append(True)
        with gate:
            thread=threading.Thread(target=release);thread.start();thread.join(2)
            self.assertEqual(errors,[True])
            self.assertTrue(gate.acquire(False));gate.release()
