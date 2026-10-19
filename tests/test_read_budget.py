import threading
import time
import unittest
from app.read_budget import ReadBudget,ReadCancelled


class ReadBudgetTest(unittest.TestCase):
    def test_limits_and_different_drive_bypass_blocked_head(self):
        budget=ReadBudget(per_drive=1);entered=threading.Event();blocked=threading.Event()
        def same_drive():
            with budget.slot('C:/second'):blocked.set()
        def other_drive():
            with budget.slot('D:/third'):entered.set()
        with budget.slot('C:/first'):
            first=threading.Thread(target=same_drive);first.start()
            deadline=time.monotonic()+2
            while budget.snapshot()['waiting']<1 and time.monotonic()<deadline:time.sleep(.01)
            self.assertEqual(budget.snapshot()['waiting'],1)
            second=threading.Thread(target=other_drive);second.start()
            self.assertTrue(entered.wait(2));self.assertFalse(blocked.is_set())
            second.join(2)
        first.join(2);self.assertTrue(blocked.is_set());self.assertEqual(budget.snapshot()['active'],0)

    def test_global_cap_and_cancelled_waiter_cleanup(self):
        budget=ReadBudget();cancel=threading.Event();cancelled=threading.Event()
        def waiting():
            try:
                with budget.slot('E:/third',cancel):self.fail('must not enter')
            except ReadCancelled:cancelled.set()
        with budget.slot('C:/first'),budget.slot('D:/second'):
            worker=threading.Thread(target=waiting);worker.start()
            cancel.set();self.assertTrue(cancelled.wait(2));worker.join(2)
            self.assertEqual(budget.snapshot()['active'],2);self.assertEqual(budget.snapshot()['waiting'],0)
        self.assertEqual(budget.snapshot()['active'],0)

    def test_priority_is_bounded_and_release_restarts_budget(self):
        now=[0.];budget=ReadBudget(clock=lambda:now[0])
        for stamp in (0,3,6,9,12,15,18):
            now[0]=stamp;budget.activity('player',True)
        self.assertFalse(budget.snapshot()['yielding'],'stuck preparation cannot starve background reads')
        budget.activity('player',False);budget.activity('player',True)
        self.assertTrue(budget.snapshot()['yielding'])
        now[0]+=5;self.assertFalse(budget.snapshot()['yielding'])

    def test_urgent_release_wakes_waiter_and_exceptions_release_slot(self):
        budget=ReadBudget();entered=threading.Event();budget.activity('player',True)
        def waiting():
            with budget.slot('C:/file'):entered.set()
        worker=threading.Thread(target=waiting);worker.start()
        self.assertFalse(entered.wait(.15));budget.activity('player',False)
        self.assertTrue(entered.wait(2));worker.join(2)
        with self.assertRaises(ValueError):
            with budget.slot('C:/file'):raise ValueError()
        self.assertEqual(budget.snapshot()['active'],0)

    def test_unc_share_is_the_budget_key_and_diagnostics_have_no_paths(self):
        budget=ReadBudget();cancel=threading.Event();cancel.set()
        with budget.slot(r'\\nas\videos\one.mkv'):
            with self.assertRaises(ReadCancelled):
                with budget.slot(r'\\NAS\VIDEOS\two.ts',cancel):pass
            with budget.slot(r'\\nas\other\three.mkv'):self.assertEqual(budget.snapshot()['active'],2)
        self.assertNotIn('nas',str(budget.snapshot()))

    def test_dead_owners_do_not_fill_reservations_forever(self):
        now=[0.];budget=ReadBudget(clock=lambda:now[0])
        for index in range(128):budget.activity(str(index),True)
        now[0]=25;budget.activity('new',True)
        self.assertEqual(len(budget.urgent),1);self.assertTrue(budget.snapshot()['yielding'])


if __name__=='__main__':unittest.main()
